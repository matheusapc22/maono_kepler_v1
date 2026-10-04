import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

import { buildApiError } from "../src/lib/api-transport.ts";
import { normalizeUserError } from "../src/lib/user-error-catalog.ts";
import {
  beginClientSaveAttempt,
  clientSaveTotalDurationMs,
} from "../src/pages/Kepler/save-observability.ts";
import {
  clearProjectUpdateRecovery,
  executePreparedProjectUpdate,
  getProjectUpdateRecovery,
  isSaveRequestAbort,
  prepareProjectUpdateSnapshot,
  rememberProjectUpdateRecovery,
} from "../src/pages/Kepler/save-operation-resilience.ts";

const source = await readFile(
  new URL("../src/pages/Kepler/components/maono-save-button.tsx", import.meta.url),
  "utf8",
);
const sourceFile = ts.createSourceFile(
  "maono-save-button.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX,
);

// Exercise the actual component handlers, with its state setters and external
// effects isolated. Serialization, HTTP handling and recovery use real helpers.
function handlerSource(name) {
  const matches = [];
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      matches.push(node.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.equal(matches.length, 1, `Expected one production handler: ${name}`);
  return matches[0];
}

const { outputText: handlers } = ts.transpileModule(
  [
    "userErrorMessage", "getSaveFailureMessage", "resolveConfigRevision",
    "executeExistingProjectSnapshot", "handleExistingProjectSave",
  ].map(handlerSource).join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
);

function draft(label = "Edição local") {
  return {
    version: "v1",
    config: {
      visState: {
        layers: [{ id: "points", config: { label, color: [180, 40, 90] } }],
        filters: [{ id: "category", value: ["B"], enabled: true }],
      },
    },
    datasets: [],
  };
}

let projectCounter = 0;
function saveHarness({ statuses = [409], recovery = false, canSave = true, payload } = {}) {
  const projectSlug = `conflict-test-${++projectCounter}`;
  const mapState = draft();
  const context = {
    version: 7,
    project: { id: 11, configRevision: 7 },
    organization: { id: 3 },
    capabilities: { saveMap: canSave },
    mode: "edit",
  };
  const pendingUpdateRecovery = recovery ? prepareProjectUpdateSnapshot({
    attempt: beginClientSaveAttempt("update"),
    projectSlug,
    config: draft("Snapshot da tentativa cancelada"),
    expectedConfigRevision: 7,
    legacy: null,
  }) : null;
  if (pendingUpdateRecovery) rememberProjectUpdateRecovery(pendingUpdateRecovery);

  const state = {
    saving: false, stalled: false, message: "", messageType: "success",
    pendingUpdateRecovery,
  };
  const calls = [];
  const telemetry = [];
  const completions = [];
  const previews = [];
  let refreshes = 0;
  const dependencies = {
    context, mapState, projectSlug, pendingUpdateRecovery,
    canSaveExisting: canSave,
    operationInFlightRef: { current: false },
    activeSaveControllerRef: { current: null },
    ASYNC_THUMBNAIL_ENABLED: true,
    state,
    setSaving: value => { state.saving = value; },
    setSaveStalled: value => { state.stalled = value; },
    setMessage: value => { state.message = value; },
    setMessageType: value => { state.messageType = value; },
    refresh: () => {
      refreshes += 1;
      // Model the destructive provider refresh that caused this regression.
      Object.assign(mapState, draft("Configuração remota"));
      context.version = 99;
      context.project.configRevision = 99;
    },
    emitSaveTelemetry: (event, details) => telemetry.push({ event, details }),
    emitClientSaveFailure: (...args) => telemetry.push({ event: "client_failure", args }),
    finishPendingMapSave: (...args) => completions.push(args),
    enqueuePreview: (...args) => previews.push(args),
    handlePreviewState: () => {},
    normalizeUserError, buildApiError, clientSaveTotalDurationMs,
    isSaveRequestAbort, rememberProjectUpdateRecovery, clearProjectUpdateRecovery,
    beginClientSaveAttempt, prepareProjectUpdateSnapshot,
    serializeProjectConfig: value => structuredClone(value),
    getMaonoConfigForSave: () => null,
    legacyCapture: async () => null,
    executePreparedProjectUpdate: options => executePreparedProjectUpdate({
      ...options,
      fetchImpl: async (url, init) => {
        calls.push({ url, init, payload: JSON.parse(init.body) });
        const status = statuses[calls.length - 1];
        assert.ok(status, "Only explicit user save calls may issue a request");
        return new Response(JSON.stringify(payload ?? (status === 200
          ? { ok: true, configRevision: 8 }
          : {
            ok: false,
            configRevision: 99,
            error: {
              code: status === 403 ? "PERMISSION_DENIED" : "PROJECT_CONFIG_REVISION_CONFLICT",
              category: status === 403 ? "PERMISSION" : "PROJECT",
              retryable: false,
            },
          })), { status, headers: { "Content-Type": "application/json" } });
      },
    }),
  };
  const makeHandlers = new Function(...Object.keys(dependencies), `
    function setPendingUpdateRecovery(value) {
      pendingUpdateRecovery = value;
      state.pendingUpdateRecovery = value;
    }
    ${handlers}
    return { save: handleExistingProjectSave };
  `);
  return {
    ...makeHandlers(...Object.values(dependencies)),
    mapState, context, state, calls, telemetry, completions, previews,
    pendingUpdateRecovery, projectSlug,
    get refreshes() { return refreshes; },
    get inFlight() { return dependencies.operationInFlightRef.current; },
    get activeController() { return dependencies.activeSaveControllerRef.current; },
  };
}

function assertConflictPreserved(harness, expectedDraft) {
  assert.equal(harness.refreshes, 0, "409 must not refresh or remount the map");
  assert.deepEqual(harness.mapState, expectedDraft, "Keep live layers and filters intact");
  assert.equal(harness.context.version, 7, "Do not adopt the conflicting remote revision");
  assert.equal(harness.context.project.configRevision, 7);
  assert.equal(harness.state.messageType, "error");
  assert.match(harness.state.message, /conflito/i);
  assert.match(harness.state.message, /alterações continuam neste mapa e não foram salvas/);
  assert.match(harness.state.message, /Preserve-as antes de recarregar/);
  assert.deepEqual(harness.completions.at(-1), ["error", harness.state.message]);
  assert.equal(harness.state.saving, false);
  assert.equal(harness.state.stalled, false);
  assert.equal(harness.inFlight, false);
  assert.equal(harness.activeController, null);
  assert.equal(harness.previews.length, 0);
}

test("409 preserves draft and expected revision across explicit retries, without automatic retry", async () => {
  const harness = saveHarness({ statuses: [409, 409] });
  const before = structuredClone(harness.mapState);
  await harness.save();
  assert.equal(harness.calls.length, 1);
  assertConflictPreserved(harness, before);
  assert.deepEqual(harness.calls[0].payload.config, before);

  // Further edits after the failed attempt must also remain saveable.
  harness.mapState.config.visState.layers[0].config.label = "Mais uma edição local";
  harness.mapState.config.visState.filters[0].value = ["C"];
  const edited = structuredClone(harness.mapState);
  await harness.save();
  assert.equal(harness.calls.length, 2);
  assertConflictPreserved(harness, edited);
  assert.deepEqual(harness.calls[1].payload.config, edited);
  assert.deepEqual(harness.calls.map(call => call.payload.expectedConfigRevision), [7, 7]);
  assert.ok(harness.calls.every(call => call.init.method === "PUT"));
  assert.equal(harness.telemetry.filter(entry => entry.event === "map_save_conflict").length, 2);
  assert.equal(harness.telemetry.filter(entry => entry.event === "map_save_failed").length, 2);
});

test("409 during recovery preserves newer live edits and releases only the rejected snapshot", async () => {
  const harness = saveHarness({ statuses: [409, 409], recovery: true });
  const before = structuredClone(harness.mapState);
  await harness.save();
  assertConflictPreserved(harness, before);
  assert.equal(harness.calls[0].init.body, harness.pendingUpdateRecovery.serialized.body);
  assert.equal(harness.state.pendingUpdateRecovery, null);
  assert.equal(getProjectUpdateRecovery(harness.projectSlug), null);
  await harness.save();
  assertConflictPreserved(harness, before);
  assert.deepEqual(harness.calls[1].payload.config, before);
  assert.deepEqual(harness.calls.map(call => call.payload.expectedConfigRevision), [7, 7]);
});

test("409 without a recognized error code still preserves draft and gives safe feedback", async () => {
  const harness = saveHarness({ payload: { ok: false } });
  const before = structuredClone(harness.mapState);
  await harness.save();
  assertConflictPreserved(harness, before);
  assert.equal(harness.calls.length, 1);
});

test("403 still revalidates permissions and never reports a successful save", async () => {
  const harness = saveHarness({ statuses: [403] });
  await harness.save();
  assert.equal(harness.refreshes, 1);
  assert.equal(harness.state.messageType, "error");
  assert.doesNotMatch(harness.state.message, /conflito/i);
  assert.equal(harness.completions.at(-1)[0], "error");
  assert.equal(harness.previews.length, 0);
  assert.equal(harness.state.saving, false);
});

test("successful save and recovery keep the existing refresh and preview behavior", async () => {
  for (const recovery of [false, true]) {
    const harness = saveHarness({ statuses: [200], recovery });
    await harness.save();
    assert.equal(harness.refreshes, 1);
    assert.equal(harness.state.messageType, "success");
    assert.equal(harness.completions.at(-1)[0], "success");
    assert.equal(harness.previews.length, 1);
    assert.equal(harness.previews[0][1], 8);
    assert.equal(harness.state.pendingUpdateRecovery, null);
    assert.equal(getProjectUpdateRecovery(harness.projectSlug), null);
    assert.equal(harness.state.saving, false);
  }
});

test("save capability guard still prevents unauthorized update requests", async () => {
  const harness = saveHarness({ canSave: false });
  await harness.save();
  assert.equal(harness.calls.length, 0);
  assert.equal(harness.refreshes, 0);
  assert.equal(harness.state.messageType, "error");
  assert.match(harness.state.message, /permissão/);
});
