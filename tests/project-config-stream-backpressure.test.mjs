import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { withStreamInactivityWatchdog } from "../functions/api/projects/[slug]/config-stream.js";

const source = readFileSync(
  new URL("../functions/api/projects/[slug]/config-stream.js", import.meta.url),
  "utf8",
);

test("LOAD-01H2 removes recursive start pump and uses demand-driven pull", () => {
  assert.match(source, /pull\(controller\)/);
  assert.match(source, /\{ highWaterMark: 0 \}/);
  assert.doesNotMatch(source, /const pump\s*=/);
  assert.doesNotMatch(source, /pump\(\);/);
  assert.doesNotMatch(source, /start\(controller\)/);
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
