import assert from "node:assert/strict";
import test from "node:test";

import {
  ViewerWorkingCopyStore,
  viewerOperationRegistry,
} from "../src/pages/Kepler/change-requests/viewer-working-copy.ts";

function memoryStorage() {
  const values = new Map();
  return {
    async get(key) {
      const value = values.get(key);
      return value ? structuredClone(value) : null;
    },
    async put(value) {
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

function pointOperation(id = "op-1") {
  return {
    id,
    type: "point.create",
    version: 1,
    payload: { latitude: -15.78, longitude: -47.92, properties: { name: "Ponto" } },
    createdAt: "2026-09-04T12:00:00.000Z",
  };
}

test("registry inicial suporta somente point.create v1", () => {
  assert.deepEqual(Object.keys(viewerOperationRegistry), ["point.create"]);
  assert.equal(viewerOperationRegistry["point.create"].version, 1);
});

test("working copy usa uma chave estável por organização/projeto/usuário", async () => {
  const storage = memoryStorage();
  const first = new ViewerWorkingCopyStore(identity, storage);
  const second = new ViewerWorkingCopyStore(identity, storage);
  assert.equal(first.key, "7:42:9");
  assert.equal(second.key, first.key);
});

test("operação, baseRevision e submissionKey sobrevivem a nova instância do store", async () => {
  const storage = memoryStorage();
  const first = new ViewerWorkingCopyStore(identity, storage);
  const saved = await first.appendOperation(184, pointOperation());

  const afterRefresh = new ViewerWorkingCopyStore(identity, storage);
  const restored = await afterRefresh.load();

  assert.equal(restored.baseRevision, 184);
  assert.equal(restored.submissionKey, saved.submissionKey);
  assert.equal(restored.operations.length, 1);
  assert.deepEqual(restored.operations[0], pointOperation());
});

test("snapshot é cópia independente e não altera o valor persistido", async () => {
  const storage = memoryStorage();
  const store = new ViewerWorkingCopyStore(identity, storage);
  await store.appendOperation(184, pointOperation());
  const snapshot = await store.snapshot();
  snapshot.operations.length = 0;
  assert.equal((await store.load()).operations.length, 1);
});

test("não aceita operation id duplicado nem operação desconhecida", async () => {
  const storage = memoryStorage();
  const store = new ViewerWorkingCopyStore(identity, storage);
  await store.appendOperation(184, pointOperation());

  await assert.rejects(
    () => store.appendOperation(184, pointOperation()),
    /WORKING_COPY_OPERATION_ID_DUPLICATED/,
  );
  await assert.rejects(
    () => store.appendOperation(184, { ...pointOperation("op-2"), type: "buffer.create" }),
    /WORKING_COPY_OPERATION_UNSUPPORTED/,
  );
});

test("revision divergente sinaliza stale sem apagar a working copy", async () => {
  const storage = memoryStorage();
  const store = new ViewerWorkingCopyStore(identity, storage);
  await store.appendOperation(184, pointOperation());

  await assert.rejects(
    () => store.assertCurrentRevision(185),
    (error) =>
      error.code === "WORKING_COPY_BASE_REVISION_STALE" &&
      error.baseRevision === 184 &&
      error.currentRevision === 185,
  );
  assert.equal((await store.load()).operations.length, 1);
});

test("removeOperation e clear mantêm lifecycle mínimo", async () => {
  const storage = memoryStorage();
  const store = new ViewerWorkingCopyStore(identity, storage);
  await store.appendOperation(184, pointOperation("op-1"));
  await store.appendOperation(184, pointOperation("op-2"));

  const afterRemove = await store.removeOperation("op-1");
  assert.deepEqual(afterRemove.operations.map((item) => item.id), ["op-2"]);

  await store.clear();
  assert.equal(await store.load(), null);
});
