import assert from "node:assert/strict";
import test from "node:test";

import {
  MAP_LOAD_EVENT_SEQUENCE,
  sanitizeMapLoadTracePayload,
} from "../functions/_lib/map-load-observability.js";

function validTrace() {
  return {
    correlationId: "corr-s07-privacy-1234",
    projectId: 3,
    revision: 17,
    schemaVersion: 1,
    duration: 900,
    status: "success",
    events: MAP_LOAD_EVENT_SEQUENCE.map((event, index) => ({
      event,
      correlationId: "corr-s07-privacy-1234",
      projectId: 3,
      revision: 17,
      schemaVersion: 1,
      duration: index * 100,
    })),
    error: null,
  };
}

test("sanitizador reconstrói trace apenas com allowlist segura", () => {
  const input = validTrace();
  input.datasets = [{ customer: "segredo" }];
  input.config = { mapStyle: { secret: true } };
  input.geometry = { coordinates: [-47, -15] };
  input.token = "secret-token";
  input.dropboxPath = "/clientes/segredo.json";
  input.sql = "select * from clientes";
  input.events[4].payload = { rows: [{ cpf: "000" }] };
  input.events[4].url = "https://signed.example/config";

  const safe = sanitizeMapLoadTracePayload(input);
  assert.ok(safe);
  const serialized = JSON.stringify(safe).toLowerCase();

  for (const forbidden of [
    "datasets",
    "customer",
    "geometry",
    "coordinates",
    "secret-token",
    "dropboxpath",
    "/clientes/",
    "select *",
    "cpf",
    "signed.example",
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }

  assert.deepEqual(Object.keys(safe.events[0]).sort(), [
    "correlationId",
    "duration",
    "event",
    "projectId",
    "revision",
    "schemaVersion",
  ]);
});

test("sanitizador rejeita sequência fora de ordem, correlationId divergente e success sem MAP_READY", () => {
  const outOfOrder = validTrace();
  [outOfOrder.events[2], outOfOrder.events[3]] = [
    outOfOrder.events[3],
    outOfOrder.events[2],
  ];
  assert.equal(sanitizeMapLoadTracePayload(outOfOrder), null);

  const divergent = validTrace();
  divergent.events[5].correlationId = "corr-other-12345678";
  assert.equal(sanitizeMapLoadTracePayload(divergent), null);

  const incomplete = validTrace();
  incomplete.events.pop();
  assert.equal(sanitizeMapLoadTracePayload(incomplete), null);
});
