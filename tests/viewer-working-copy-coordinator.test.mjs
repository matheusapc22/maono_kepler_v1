import assert from "node:assert/strict";
import test from "node:test";

import { coordinateViewerWorkingCopyStore } from "../src/pages/Kepler/change-requests/viewer-working-copy-coordinator.ts";
import { ViewerWorkingCopyStore } from "../src/pages/Kepler/change-requests/viewer-working-copy.ts";

function memoryStorage() {
  const values = new Map();
  return {
    async get(key) {
      // Force a yield so two uncoordinated read-modify-write calls would be
      // able to observe the same initial snapshot.
      await Promise.resolve();
      const value = values.get(key);
      return value ? structuredClone(value) : null;
    },
    async put(value) {
      await Promise.resolve();
      values.set(value.key, structuredClone(value));
    },
    async delete(key) {
      values.delete(key);
    },
  };
}

const identity = {
  organizationId: 7,
  projectId: 42,
  projectSlug: "demo",
  userId: 9,
};

function pointOperation() {
  return {
    id: "op-point",
    type: "point.create",
    version: 1,
    payload: {
      latitude: -15.78,
      longitude: -47.92,
      targetLayerId: "layer-existing",
      targetDataId: "data-existing",
      targetLabel: "Leads",
      properties: { name: "Ponto" },
    },
    createdAt: "2026-09-06T01:00:00.000Z",
  };
}

function blendingOperation() {
  return {
    id: "op-blending",
    type: "map.blending.update",
    version: 1,
    payload: {
      before: { layers: "normal", overlays: "normal" },
      after: { layers: "additive", overlays: "screen" },
    },
    createdAt: "2026-09-06T01:00:01.000Z",
  };
}

test("runtimes compostos não perdem operações em gravações concorrentes", async () => {
  const store = new ViewerWorkingCopyStore(identity, memoryStorage());
  const coordinated = coordinateViewerWorkingCopyStore(store);

  assert.equal(coordinated, store);
  assert.equal(coordinateViewerWorkingCopyStore(store), store);

  await Promise.all([
    store.appendOperation(184, pointOperation()),
    store.appendOperation(184, blendingOperation()),
  ]);

  const saved = await store.load();
  assert.ok(saved);
  assert.equal(saved.baseRevision, 184);
  assert.deepEqual(
    saved.operations.map((operation) => operation.id),
    ["op-point", "op-blending"],
  );
  assert.equal(new Set(saved.operations.map((operation) => operation.id)).size, 2);
});
