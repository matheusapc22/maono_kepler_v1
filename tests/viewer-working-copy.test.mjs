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

function controlledWriteStorage() {
  const values = new Map();
  let blockNextPut = false;
  let resolveWriteStarted = null;
  let releaseBlockedWrite = null;

  const storage = {
    async get(key) {
      const value = values.get(key);
      return value ? structuredClone(value) : null;
    },
    async put(value) {
      if (blockNextPut) {
        blockNextPut = false;
        resolveWriteStarted?.();
        await new Promise((resolve) => {
          releaseBlockedWrite = resolve;
        });
      }
      values.set(value.key, structuredClone(value));
    },
    async delete(key) {
      values.delete(key);
    },
  };

  return {
    storage,
    blockNextPut() {
      blockNextPut = true;
      return new Promise((resolve) => {
        resolveWriteStarted = resolve;
      });
    },
    releasePut() {
      releaseBlockedWrite?.();
      releaseBlockedWrite = null;
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
    payload: {
      latitude: -15.78,
      longitude: -47.92,
      targetLayerId: "layer-existing",
      targetDataId: "data-existing",
      targetLabel: "Leads",
      properties: { name: "Ponto" },
    },
    createdAt: "2026-09-04T12:00:00.000Z",
  };
}

function newLayerPointOperation(id) {
  return {
    ...pointOperation(id),
    payload: {
      ...pointOperation(id).payload,
      targetLayerId: null,
      targetDataId: null,
      targetLabel: "Pontos adicionados",
    },
  };
}

function stylePayload(color = [220, 20, 20]) {
  return {
    targetLayerId: "buffer-layer",
    targetDataId: "buffer-data",
    targetLabel: "Buffer radial · 500 m",
    changes: { fixedColor: color },
  };
}

test("registry suporta operações Viewer v1", () => {
  assert.deepEqual(Object.keys(viewerOperationRegistry), [
    "point.create",
    "layer.style.update",
    "buffer.create",
    "isochrone.create",
  ]);
  assert.equal(viewerOperationRegistry["point.create"].version, 1);
  assert.equal(viewerOperationRegistry["layer.style.update"].version, 1);
  assert.equal(viewerOperationRegistry["buffer.create"].version, 1);
  assert.equal(viewerOperationRegistry["isochrone.create"].version, 1);
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

test("Viewer agrupa múltiplos pontos na mesma nova camada temporária", async () => {
  const storage = memoryStorage();
  const store = new ViewerWorkingCopyStore(identity, storage);
  const first = await store.appendOperation(184, newLayerPointOperation("op-1"));
  const second = await store.appendOperation(184, newLayerPointOperation("op-2"));

  const firstPayload = first.operations[0].payload;
  const secondPayload = second.operations[1].payload;
  assert.match(firstPayload.targetLayerId, /^tmp_layer_/);
  assert.match(firstPayload.targetDataId, /^tmp_data_/);
  assert.equal(firstPayload.targetMode, "new");
  assert.equal(secondPayload.targetLayerId, firstPayload.targetLayerId);
  assert.equal(secondPayload.targetDataId, firstPayload.targetDataId);

  const afterPartial = await store.completeSubmission(["op-1"]);
  const third = await store.appendOperation(184, newLayerPointOperation("op-3"));
  const remainingPayload = afterPartial.operations[0].payload;
  const thirdPayload = third.operations.at(-1).payload;
  assert.equal(thirdPayload.targetLayerId, remainingPayload.targetLayerId);
  assert.equal(thirdPayload.targetDataId, remainingPayload.targetDataId);
});

test("style update é coalescido por camada e reversão remove a operação", async () => {
  const storage = memoryStorage();
  const store = new ViewerWorkingCopyStore(identity, storage);

  const first = await store.upsertLayerStyleOperation(184, stylePayload([220, 20, 20]));
  const firstOperation = first.operations[0];
  assert.equal(first.operations.length, 1);
  assert.equal(firstOperation.type, "layer.style.update");
  assert.deepEqual(firstOperation.payload.changes.fixedColor, [220, 20, 20]);

  const second = await store.upsertLayerStyleOperation(184, stylePayload([100, 30, 30]));
  assert.equal(second.operations.length, 1);
  assert.equal(second.operations[0].id, firstOperation.id);
  assert.deepEqual(second.operations[0].payload.changes.fixedColor, [100, 30, 30]);

  const reverted = await store.upsertLayerStyleOperation(184, {
    ...stylePayload(),
    changes: {},
  });
  assert.equal(reverted.operations.length, 0);
});

test("style update rejeita chaves e cores fora do contrato", async () => {
  const storage = memoryStorage();
  const store = new ViewerWorkingCopyStore(identity, storage);
  await assert.rejects(
    () =>
      store.upsertLayerStyleOperation(184, {
        ...stylePayload(),
        changes: { internalReduxPatch: true },
      }),
    /WORKING_COPY_OPERATION_INVALID/,
  );
  await assert.rejects(
    () => store.upsertLayerStyleOperation(184, stylePayload([300, 0, 0])),
    /WORKING_COPY_OPERATION_INVALID/,
  );
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
    () =>
      store.appendOperation(184, {
        ...pointOperation("op-2"),
        type: "unsupported.operation",
      }),
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

test("completeSubmission remove apenas selecionadas e rotaciona submissionKey", async () => {
  const storage = memoryStorage();
  const store = new ViewerWorkingCopyStore(identity, storage);
  await store.appendOperation(184, pointOperation("op-1"));
  const before = await store.appendOperation(184, pointOperation("op-2"));

  const afterPartial = await store.completeSubmission(["op-1"]);
  assert.deepEqual(afterPartial.operations.map((item) => item.id), ["op-2"]);
  assert.notEqual(afterPartial.submissionKey, before.submissionKey);
  assert.equal(afterPartial.baseRevision, before.baseRevision);

  const afterAll = await store.completeSubmission(["op-2"]);
  assert.equal(afterAll, null);
  assert.equal(await store.load(), null);
});

test("clear é terminal e vence uma gravação de estilo já em voo", async () => {
  const controlled = controlledWriteStorage();
  const store = new ViewerWorkingCopyStore(identity, controlled.storage);
  await store.appendOperation(184, pointOperation("op-race"));

  const writeStarted = controlled.blockNextPut();
  const styleWrite = store.upsertLayerStyleOperation(
    184,
    stylePayload([100, 30, 30]),
  );
  await writeStarted;

  const clearing = store.clear();
  controlled.releasePut();
  await Promise.all([styleWrite, clearing]);

  assert.equal(store.writable, false);
  assert.equal(await controlled.storage.get(store.key), null);
  assert.equal(await store.load(), null);
  await assert.rejects(
    () => store.upsertLayerStyleOperation(184, stylePayload()),
    (error) => error.code === "WORKING_COPY_WRITE_CANCELLED",
  );
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
