import assert from "node:assert/strict";
import test from "node:test";

import {
  assertMapToolStateInvariant,
  createInitialMapToolState,
  isMapToolStateValid,
  mapToolReducer,
} from "../src/pages/Kepler/components/map-overlay/analysis-tools/map-tool-state.ts";

const POINT_A = { longitude: -46.6333, latitude: -23.5505 };
const POINT_B = { longitude: -46.62, latitude: -23.56 };
const MULTI_SESSION = {
  kind: "buffer",
  id: "buffer-session-1",
  insertionMode: "multi",
  dataId: null,
};

function reduce(initial, ...actions) {
  return actions.reduce(mapToolReducer, initial);
}

test("estado inicial é idle e satisfaz as invariantes", () => {
  const state = createInitialMapToolState();

  assert.deepEqual(state, {
    mode: "idle",
    tool: null,
    preliminaryOptions: null,
    pendingPoint: null,
    session: null,
  });
  assert.equal(isMapToolStateValid(state), true);
  assert.equal(assertMapToolStateInvariant(state), state);
});

test("Buffer entra em modo multiorigem automaticamente ao ser selecionado", () => {
  const selecting = reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "buffer" },
  );

  assert.equal(selecting.mode, "selectingTool");
  assert.equal(selecting.tool, "buffer");
  assert.equal(selecting.menu, "buffer");
  assert.deepEqual(selecting.preliminaryOptions, {
    kind: "buffer",
    insertionMode: "multi",
  });
  assert.equal(selecting.pendingPoint, null);
  assert.equal(selecting.session, null);
  assert.equal(isMapToolStateValid(selecting), true);
});

test("modo single não pertence mais ao estado canônico de Buffer", () => {
  const selecting = reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "buffer" },
  );

  const attemptedSingle = mapToolReducer(selecting, {
    type: "SET_PRELIMINARY_OPTIONS",
    options: { kind: "buffer", insertionMode: "single" },
  });

  assert.equal(attemptedSingle, selecting);
  assert.equal(attemptedSingle.preliminaryOptions.insertionMode, "multi");
});

test("Buffer canônico exige sessão explícita antes do placement", () => {
  const selecting = reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "buffer" },
  );

  const withoutSession = mapToolReducer(selecting, {
    type: "START_PLACEMENT",
  });
  const withSession = mapToolReducer(selecting, {
    type: "START_PLACEMENT",
    session: MULTI_SESSION,
  });

  assert.equal(withoutSession, selecting);
  assert.equal(withSession.mode, "placingPoint");
  assert.deepEqual(withSession.session, MULTI_SESSION);
  assert.equal(isMapToolStateValid(withSession), true);
});

test("Buffer percorre placement, configuração e review na sessão multiorigem", () => {
  const state = reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "buffer" },
    { type: "START_PLACEMENT", session: MULTI_SESSION },
    { type: "POINT_PLACED", point: POINT_A },
    { type: "SUBMIT_CONFIGURATION" },
    {
      type: "ANALYSIS_CREATED",
      preview: { kind: "buffer", dataId: "buffer-preview-1" },
    },
  );

  assert.equal(state.mode, "reviewing");
  assert.equal(state.tool, "buffer");
  assert.deepEqual(state.pendingPoint, POINT_A);
  assert.equal(state.preliminaryOptions?.insertionMode, "multi");
  assert.deepEqual(state.session, {
    ...MULTI_SESSION,
    dataId: "buffer-preview-1",
  });
  assert.equal(state.preview.dataId, "buffer-preview-1");
  assert.equal(isMapToolStateValid(state), true);
});

test("cancelar ponto atual em Buffer preserva a sessão e retorna ao placement", () => {
  const configuring = reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "buffer" },
    { type: "START_PLACEMENT", session: MULTI_SESSION },
    { type: "POINT_PLACED", point: POINT_B },
  );

  const cancelled = mapToolReducer(configuring, {
    type: "CANCEL_PENDING_POINT",
  });

  assert.equal(cancelled.mode, "placingPoint");
  assert.equal(cancelled.tool, "buffer");
  assert.equal(cancelled.pendingPoint, null);
  assert.deepEqual(cancelled.session, MULTI_SESSION);
});

test("Buffer confirmado pode continuar na mesma sessão e ser finalizado", () => {
  const reviewed = reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "buffer" },
    { type: "START_PLACEMENT", session: MULTI_SESSION },
    { type: "POINT_PLACED", point: POINT_A },
    { type: "SUBMIT_CONFIGURATION" },
    {
      type: "ANALYSIS_CREATED",
      preview: { kind: "buffer", dataId: "buffer-session-layer" },
    },
  );

  assert.equal(reviewed.mode, "reviewing");
  assert.deepEqual(reviewed.session, {
    ...MULTI_SESSION,
    dataId: "buffer-session-layer",
  });

  const nextPlacement = mapToolReducer(reviewed, { type: "CONTINUE_MULTI" });
  const finished = mapToolReducer(nextPlacement, { type: "FINISH_MULTI" });

  assert.equal(nextPlacement.mode, "placingPoint");
  assert.equal(nextPlacement.pendingPoint, null);
  assert.deepEqual(nextPlacement.session, {
    ...MULTI_SESSION,
    dataId: "buffer-session-layer",
  });
  assert.deepEqual(finished, createInitialMapToolState());
});

test("isócrona só entra em configuração depois de receber coordenada válida", () => {
  const placing = reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "isochrone" },
    { type: "START_PLACEMENT" },
  );

  const invalidPoint = mapToolReducer(placing, {
    type: "POINT_PLACED",
    point: { longitude: 400, latitude: -23 },
  });
  const configuring = mapToolReducer(placing, {
    type: "POINT_PLACED",
    point: POINT_A,
  });

  assert.equal(invalidPoint, placing);
  assert.equal(configuring.mode, "configuring");
  assert.equal(configuring.tool, "isochrone");
  assert.deepEqual(configuring.pendingPoint, POINT_A);
  assert.equal(configuring.preliminaryOptions, null);
});

test("marcador usa o mesmo lifecycle de placement mas encerra após criação", () => {
  const configuring = reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "marker" },
    { type: "START_PLACEMENT" },
    { type: "POINT_PLACED", point: POINT_A },
  );

  assert.equal(configuring.mode, "configuring");
  assert.equal(configuring.tool, "marker");

  const completed = mapToolReducer(configuring, {
    type: "ANALYSIS_CREATED",
  });

  assert.deepEqual(completed, createInitialMapToolState());
});

test("ações fora da etapa esperada não criam combinações inválidas", () => {
  const idle = createInitialMapToolState();

  for (const action of [
    { type: "START_PLACEMENT" },
    { type: "POINT_PLACED", point: POINT_A },
    { type: "SUBMIT_CONFIGURATION" },
    {
      type: "ANALYSIS_CREATED",
      preview: { kind: "isochrone", dataId: "preview" },
    },
    { type: "CONTINUE_MULTI" },
    { type: "FINISH_MULTI" },
  ]) {
    assert.equal(mapToolReducer(idle, action), idle);
  }
});

test("CANCEL_TOOL e RESET sempre retornam ao estado canônico idle", () => {
  const placing = reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "isochrone" },
    { type: "START_PLACEMENT" },
  );

  assert.deepEqual(
    mapToolReducer(placing, { type: "CANCEL_TOOL" }),
    createInitialMapToolState(),
  );
  assert.deepEqual(
    mapToolReducer(placing, { type: "RESET" }),
    createInitialMapToolState(),
  );
});

test("invariante rejeita placingPoint sem ferramenta", () => {
  const impossible = {
    mode: "placingPoint",
    tool: null,
    preliminaryOptions: null,
    pendingPoint: null,
    session: null,
  };

  assert.equal(isMapToolStateValid(impossible), false);
  assert.throws(
    () => assertMapToolStateInvariant(impossible),
    /Invalid map tool state: placingPoint/,
  );
});

test("preview incompatível com a ferramenta é rejeitado", () => {
  const configuring = reduce(
    createInitialMapToolState(),
    { type: "OPEN_TOOL_MENU" },
    { type: "SELECT_TOOL", tool: "isochrone" },
    { type: "START_PLACEMENT" },
    { type: "POINT_PLACED", point: POINT_A },
    { type: "SUBMIT_CONFIGURATION" },
  );

  const invalidPreview = mapToolReducer(configuring, {
    type: "ANALYSIS_CREATED",
    preview: { kind: "buffer", dataId: "wrong-kind" },
  });

  assert.equal(invalidPreview, configuring);
});
