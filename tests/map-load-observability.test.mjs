import assert from "node:assert/strict";
import test from "node:test";

import { MAP_LOAD_EVENTS } from "../src/pages/Kepler/observability/map-load-events.ts";
import { MapLoadTrace } from "../src/pages/Kepler/observability/map-load-trace.ts";

test("S07 congela os nove eventos de carregamento na ordem arquitetural", () => {
  assert.deepEqual([...MAP_LOAD_EVENTS], [
    "MAP_OPEN_REQUESTED",
    "SESSION_RESOLVED",
    "PROJECT_RESOLVED",
    "LOAD_GUARD_STARTED",
    "CONFIG_REQUESTED",
    "CONFIG_VALIDATED",
    "MIGRATED",
    "ENGINE_HYDRATION_STARTED",
    "MAP_READY",
  ]);
});

test("trace completo usa um correlationId, duração cumulativa e MAP_READY único", () => {
  let now = 1_000;
  const trace = new MapLoadTrace({
    correlationId: "corr-s07-12345678",
    now: () => now,
  });

  MAP_LOAD_EVENTS.forEach((event, index) => {
    if (event === "PROJECT_RESOLVED") {
      assert.equal(
        trace.record(event, {
          projectId: 3,
          revision: 17,
          schemaVersion: 1,
        }),
        true,
      );
    } else {
      assert.equal(trace.record(event), true);
    }
    now += 25 + index;
  });

  assert.equal(trace.record("MAP_READY"), false);
  const payload = trace.toPayload();
  assert.equal(payload.status, "success");
  assert.equal(payload.events.length, 9);
  assert.equal(payload.projectId, 3);
  assert.equal(payload.revision, 17);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(new Set(payload.events.map((event) => event.correlationId)).size, 1);
  assert.equal(payload.events.at(-1)?.event, "MAP_READY");

  for (let index = 1; index < payload.events.length; index += 1) {
    assert.ok(payload.events[index].duration >= payload.events[index - 1].duration);
  }

  for (const event of payload.events) {
    assert.deepEqual(Object.keys(event).sort(), [
      "correlationId",
      "duration",
      "event",
      "projectId",
      "revision",
      "schemaVersion",
    ]);
  }
});

test("máquina de estados rejeita salto e erro terminal nunca produz MAP_READY", () => {
  let now = 0;
  const trace = new MapLoadTrace({
    correlationId: "corr-s07-error-1234",
    now: () => now,
  });

  assert.equal(trace.record("MAP_OPEN_REQUESTED"), true);
  assert.equal(trace.record("PROJECT_RESOLVED"), false);
  now += 10;
  assert.equal(trace.record("SESSION_RESOLVED"), true);
  now += 10;
  assert.equal(trace.fail({
    stage: "PROJECT_RESOLVED",
    code: "PROJECT_NOT_FOUND",
    category: "PROJECT",
    retryable: false,
    status: 404,
  }), true);
  assert.equal(trace.record("PROJECT_RESOLVED"), false);
  assert.equal(trace.record("MAP_READY"), false);

  const payload = trace.toPayload();
  assert.equal(payload.status, "error");
  assert.equal(payload.events.some((event) => event.event === "MAP_READY"), false);
  assert.deepEqual(payload.error, {
    stage: "PROJECT_RESOLVED",
    code: "PROJECT_NOT_FOUND",
    category: "PROJECT",
    retryable: false,
    status: 404,
  });
});
