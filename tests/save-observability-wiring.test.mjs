import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const client = read("src/pages/Kepler/save-observability.ts");
const controller = read("src/pages/Kepler/durable-save-controller.ts");
const store = read("src/pages/Kepler/durable-save-store.ts");
const button = read("src/pages/Kepler/components/maono-save-button.tsx");
const backend = read("functions/_lib/save-observability.js");
const telemetry = read("src/pages/Kepler/map-panel/map-panel-telemetry.ts");
const pkg = JSON.parse(read("package.json"));
test("durable transport has explicit serializable headers and no in-memory recovery registry", () => {
  assert.match(client, /MAONO_SAVE_CLIENT_CONTRACT = 2/); assert.doesNotMatch(client, /WeakMap/);
  assert.match(store, /indexedDb\.open/); assert.match(store, /tx\.oncomplete/); assert.match(store, /scopeKey/); assert.match(store, /accountKey/);
  assert.match(controller, /await store\.put\(snapshot\)/); assert.match(controller, /let result = await send\(path\)/); assert.match(controller, /snapshot\.serialized\.body/);
  assert.doesNotMatch(controller, /new Map/);
});
test("stall, cancellation, recovery and completion retain safe observability", () => {
  assert.match(controller, /SAVE_STALL_NOTICE_MS = 12_000/);
  for (const event of ["map_save_requested", "map_save_serialized", "map_save_stalled", "map_save_cancelled", "map_save_recovery_requested", "map_save_recovery_succeeded", "map_save_succeeded", "map_save_failed", "map_save_conflict"]) assert.ok(button.includes(event), event);
  for (const field of ["saveId", "correlationId", "payloadBytes", "serializeDurationMs", "durationMs", "stage", "category", "retryable", "httpStatus", "expectedRevision", "candidateRevision"]) assert.match(telemetry, new RegExp(`${field}\\?`));
  assert.match(button, /serverTiming/); assert.match(button, /INFRASTRUCTURE_NETWORK_FAILURE/);
  for (const header of ["X-Maono-Save-Id", "X-Correlation-Id", "Server-Timing"]) assert.ok(backend.includes(header));
  assert.match(pkg.scripts["test:foundation-gate"], /test:save-observability/);
});
test("public old writers reject and operation API delegates into the one durable core", () => {
  for (const file of ["config.js", "save.js"]) assert.match(read(`functions/api/projects/[slug]/${file}`), /retiredSaveProtocolResponse/);
  for (const file of ["index.js", "[operationId].js", "[operationId]/payload.js"]) assert.match(read(`functions/api/projects/[slug]/save-operations/${file}`), /handleProjectSaveOperation/);
});
await import("./save-deploy-contract.test.mjs");
await import("./save-deploy-wiring.test.mjs");
