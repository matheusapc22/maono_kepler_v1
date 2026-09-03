import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { withStreamInactivityWatchdog } from "../functions/api/projects/[slug]/config-stream.js";

const source = readFileSync(
  new URL("../functions/api/projects/[slug]/config-stream.js", import.meta.url),
  "utf8",
);

async function readAllBytes(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  return { chunks, size };
}

test("LOAD-01H2 removes recursive start pump and uses demand-driven pull", () => {
  assert.match(source, /pull\(controller\)/);
  assert.match(source, /\{ highWaterMark: 0 \}/);
  assert.doesNotMatch(source, /const pump\s*=/);
  assert.doesNotMatch(source, /pump\(\);/);
  assert.doesNotMatch(source, /start\(controller\)/);
});

test("LOAD-01H3 counts server-side bytes and fails explicit premature EOF", () => {
  assert.match(source, /bytesForwarded/);
  assert.match(source, /bytesReadFromUpstream/);
  assert.match(source, /PROJECT_CONFIG_STREAM_TRUNCATED/);
  assert.match(source, /PROJECT_CONFIG_STREAM_LENGTH_MISMATCH/);
  assert.match(source, /failureStage: "dropbox_to_worker"/);
  assert.match(source, /X-Maono-Stream-Integrity-Mode/);
});

test("wrapper does not drain upstream before downstream demand", async () => {
  let upstreamPulls = 0;
  const upstream = new ReadableStream(
    {
      pull(controller) {
        upstreamPulls += 1;
        controller.enqueue(new Uint8Array([upstreamPulls]));
      },
    },
    { highWaterMark: 0 },
  );

  const wrapped = withStreamInactivityWatchdog(upstream, 1_000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(upstreamPulls, 0);

  const reader = wrapped.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.equal(first.value[0], 1);
  assert.equal(upstreamPulls, 1);

  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(upstreamPulls, 1);
  await reader.cancel("test-complete");
});

test("downstream cancel propagates to upstream reader", async () => {
  let cancelledWith = null;
  const upstream = new ReadableStream(
    {
      pull(controller) {
        controller.enqueue(new Uint8Array([1]));
      },
      cancel(reason) {
        cancelledWith = reason;
      },
    },
    { highWaterMark: 0 },
  );

  const reader = withStreamInactivityWatchdog(upstream, 1_000).getReader();
  await reader.read();
  await reader.cancel("navigation-away");
  assert.equal(cancelledWith, "navigation-away");
});

test("inactivity watchdog rejects stalled demanded read and cancels upstream", async () => {
  let upstreamCancelled = false;
  const upstream = new ReadableStream(
    {
      pull() {
        return new Promise(() => undefined);
      },
      cancel() {
        upstreamCancelled = true;
      },
    },
    { highWaterMark: 0 },
  );

  const reader = withStreamInactivityWatchdog(upstream, 15).getReader();
  await assert.rejects(reader.read(), /sem progresso|interrompido/i);
  assert.equal(upstreamCancelled, true);
});

test("exact upstream EOF closes only after forwarding every expected byte", async () => {
  const telemetry = [];
  const expected = new Uint8Array([1, 2, 3, 4, 5]);
  const upstream = new ReadableStream(
    {
      start(controller) {
        controller.enqueue(expected.slice(0, 2));
        controller.enqueue(expected.slice(2));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );

  const wrapped = withStreamInactivityWatchdog(upstream, 1_000, {
    expectedSizeBytes: expected.byteLength,
    correlationId: "corr-server-complete-1234",
    revision: 17,
    onTelemetry: (event) => telemetry.push(event),
  });

  const result = await readAllBytes(wrapped);
  assert.equal(result.size, expected.byteLength);
  assert.equal(telemetry.at(-1).event, "config_stream_complete");
  assert.equal(telemetry.at(-1).bytesReadFromUpstream, expected.byteLength);
  assert.equal(telemetry.at(-1).bytesForwarded, expected.byteLength);
  assert.equal(telemetry.at(-1).expectedSizeBytes, expected.byteLength);
  assert.equal(telemetry.at(-1).failureStage, null);
});

test("premature upstream EOF becomes PROJECT_CONFIG_STREAM_TRUNCATED instead of clean 200 body", async () => {
  const telemetry = [];
  const upstream = new ReadableStream(
    {
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );

  const reader = withStreamInactivityWatchdog(upstream, 1_000, {
    expectedSizeBytes: 5,
    correlationId: "corr-server-truncated-1234",
    revision: 23,
    onTelemetry: (event) => telemetry.push(event),
  }).getReader();

  const first = await reader.read();
  assert.equal(first.done, false);
  assert.equal(first.value.byteLength, 3);
  await assert.rejects(
    reader.read(),
    (error) => {
      assert.equal(error.code, "PROJECT_CONFIG_STREAM_TRUNCATED");
      assert.equal(error.details.expectedSizeBytes, 5);
      assert.equal(error.details.bytesReadFromUpstream, 3);
      assert.equal(error.details.bytesForwarded, 3);
      assert.equal(error.details.failureStage, "dropbox_to_worker");
      return true;
    },
  );

  assert.equal(telemetry.at(-1).event, "config_stream_error");
  assert.equal(telemetry.at(-1).code, "PROJECT_CONFIG_STREAM_TRUNCATED");
  assert.equal(telemetry.at(-1).bytesReadFromUpstream, 3);
  assert.equal(telemetry.at(-1).bytesForwarded, 3);
  assert.equal(telemetry.at(-1).failureStage, "dropbox_to_worker");
});

test("server rejects bytes beyond published size and cancels upstream", async () => {
  const telemetry = [];
  let cancelled = false;
  const upstream = new ReadableStream(
    {
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3, 4]));
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );

  const reader = withStreamInactivityWatchdog(upstream, 1_000, {
    expectedSizeBytes: 3,
    onTelemetry: (event) => telemetry.push(event),
  }).getReader();

  await assert.rejects(
    reader.read(),
    (error) => {
      assert.equal(error.code, "PROJECT_CONFIG_STREAM_LENGTH_MISMATCH");
      assert.equal(error.details.expectedSizeBytes, 3);
      assert.equal(error.details.bytesReadFromUpstream, 4);
      assert.equal(error.details.bytesForwarded, 0);
      return true;
    },
  );
  assert.equal(cancelled, true);
  assert.equal(telemetry.at(-1).code, "PROJECT_CONFIG_STREAM_LENGTH_MISMATCH");
  assert.equal(telemetry.at(-1).bytesReadFromUpstream, 4);
  assert.equal(telemetry.at(-1).bytesForwarded, 0);
});
