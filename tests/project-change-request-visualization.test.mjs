import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectChangeProposal } from "../functions/_lib/project-change-request-operations.js";
import { normalizeAnalysisAwareChangeRequestSubmission } from "../functions/_lib/project-change-request-analysis-submission.js";

function baseConfig() {
  return {
    version: "v1",
    datasets: [
      {
        version: "v1",
        data: {
          id: "data-a",
          label: "Leads",
          fields: [
            { name: "latitude", type: "real", format: "" },
            { name: "longitude", type: "real", format: "" },
            { name: "score", type: "real", format: "" },
          ],
          allData: [[-21.76, -43.35, 50]],
        },
      },
      {
        version: "v1",
        data: {
          id: "data-b",
          label: "Municípios",
          fields: [{ name: "name", type: "string", format: "" }],
          allData: [["Juiz de Fora"]],
        },
      },
    ],
    config: {
      visState: {
        layers: [
          {
            id: "layer-a",
            type: "point",
            config: {
              dataId: "data-a",
              label: "Leads",
              isVisible: true,
              columns: { lat: "latitude", lng: "longitude" },
              visConfig: { radius: 10, opacity: 0.8 },
            },
          },
          {
            id: "layer-b",
            type: "geojson",
            config: {
              dataId: "data-b",
              label: "Municípios",
              isVisible: true,
              visConfig: { opacity: 0.5 },
            },
          },
        ],
        layerOrder: ["layer-a", "layer-b"],
        filters: [
          {
            id: "filter-score",
            dataId: ["data-a"],
            name: ["score"],
            type: "range",
            value: [0, 100],
            enabled: true,
          },
        ],
      },
    },
  };
}

function op(type, payload, sequence) {
  return {
    id: `op-${sequence}`,
    sequence,
    type,
    version: 1,
    createdAt: `2026-09-05T20:4${sequence}:00.000Z`,
    payload,
  };
}

function visibility() {
  return op(
    "layer.visibility.update",
    {
      targetLayerId: "layer-b",
      targetDataId: "data-b",
      targetLabel: "Municípios",
      before: true,
      after: false,
    },
    0,
  );
}

function filterUpdate() {
  return op(
    "persistent.filter.update",
    {
      filterId: "filter-score",
      before: {
        id: "filter-score",
        dataIds: ["data-a"],
        fieldNames: ["score"],
        type: "range",
        value: [0, 100],
        enabled: true,
      },
      after: {
        id: "filter-score",
        dataIds: ["data-a"],
        fieldNames: ["score"],
        type: "range",
        value: [25, 75],
        enabled: true,
      },
    },
    1,
  );
}

function orderUpdate() {
  return op(
    "layer.order.update",
    {
      before: ["layer-a", "layer-b"],
      after: ["layer-b", "layer-a"],
    },
    2,
  );
}

test("submission Viewer aceita visibilidade, filtro persistente e ordem", () => {
  const normalized = normalizeAnalysisAwareChangeRequestSubmission({
    baseRevision: 184,
    reason: "Atualizar apresentação persistente",
    operations: [visibility(), filterUpdate(), orderUpdate()],
  });
  assert.deepEqual(
    normalized.operations.map((operation) => operation.type),
    ["layer.visibility.update", "persistent.filter.update", "layer.order.update"],
  );
});

test("proposal aplica visualizações sequencialmente sem mutar revisão-base", () => {
  const original = baseConfig();
  const proposal = buildProjectChangeProposal({
    baseConfig: original,
    operations: [visibility(), filterUpdate(), orderUpdate()],
  });

  assert.equal(
    proposal.config.config.visState.layers.find((layer) => layer.id === "layer-b").config.isVisible,
    false,
  );
  assert.deepEqual(proposal.config.config.visState.filters[0].value, [25, 75]);
  assert.deepEqual(
    proposal.config.config.visState.layers.map((layer) => layer.id),
    ["layer-b", "layer-a"],
  );
  assert.deepEqual(proposal.config.config.visState.layerOrder, ["layer-b", "layer-a"]);
  assert.deepEqual(
    proposal.projections.map((projection) => projection.type),
    ["layer.visibility.update", "persistent.filter.update", "layer.order.update"],
  );
  assert.equal(proposal.projections[0].properties.beforeLabel, "Visível");
  assert.equal(proposal.projections[0].properties.afterLabel, "Oculta");
  assert.match(proposal.projections[1].properties.beforeLabel, /score/);
  assert.match(proposal.projections[1].properties.afterLabel, /25/);

  assert.equal(original.config.visState.layers[1].config.isVisible, true);
  assert.deepEqual(original.config.visState.filters[0].value, [0, 100]);
  assert.deepEqual(original.config.visState.layerOrder, ["layer-a", "layer-b"]);
});

test("filtro persistente pode ser criado e removido de forma explícita", () => {
  const createFilter = op(
    "persistent.filter.update",
    {
      filterId: "filter-new",
      before: null,
      after: {
        id: "filter-new",
        dataIds: ["data-a"],
        fieldNames: ["score"],
        type: "range",
        value: [30, 60],
        enabled: true,
      },
    },
    0,
  );
  const created = buildProjectChangeProposal({
    baseConfig: baseConfig(),
    operations: [createFilter],
  });
  assert.ok(created.config.config.visState.filters.some((filter) => filter.id === "filter-new"));

  const removeFilter = op(
    "persistent.filter.update",
    {
      filterId: "filter-score",
      before: filterUpdate().payload.before,
      after: null,
    },
    0,
  );
  const removed = buildProjectChangeProposal({
    baseConfig: baseConfig(),
    operations: [removeFilter],
  });
  assert.equal(
    removed.config.config.visState.filters.some((filter) => filter.id === "filter-score"),
    false,
  );
});

test("visualizações inválidas falham fechado antes da submissão", () => {
  assert.throws(
    () =>
      normalizeAnalysisAwareChangeRequestSubmission({
        baseRevision: 184,
        reason: "No-op",
        operations: [
          op(
            "layer.visibility.update",
            {
              targetLayerId: "layer-a",
              targetDataId: "data-a",
              targetLabel: "Leads",
              before: true,
              after: true,
            },
            0,
          ),
        ],
      }),
    (error) => error.code === "CHANGE_REQUEST_OPERATION_INVALID" || /inválido/i.test(error.message),
  );

  assert.throws(
    () =>
      normalizeAnalysisAwareChangeRequestSubmission({
        baseRevision: 184,
        reason: "Redux arbitrário",
        operations: [
          op(
            "persistent.filter.update",
            {
              filterId: "filter-score",
              before: filterUpdate().payload.before,
              after: {
                ...filterUpdate().payload.after,
                value: { reducerPatch: true },
              },
            },
            0,
          ),
        ],
      }),
    (error) => error.code === "CHANGE_REQUEST_OPERATION_INVALID" || /inválid/i.test(error.message),
  );
});

test("target divergente vira conflito e não aplica parcialmente", () => {
  const missing = visibility();
  missing.payload.targetLayerId = "missing-layer";
  assert.throws(
    () =>
      buildProjectChangeProposal({
        baseConfig: baseConfig(),
        operations: [missing],
      }),
    (error) => error.code === "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
  );

  const conflictingOrder = orderUpdate();
  conflictingOrder.payload.before = ["layer-b", "layer-a"];
  conflictingOrder.payload.after = ["layer-a", "layer-b"];
  assert.throws(
    () =>
      buildProjectChangeProposal({
        baseConfig: baseConfig(),
        operations: [conflictingOrder],
      }),
    (error) => error.code === "CHANGE_REQUEST_OPERATION_TARGET_CONFLICT",
  );
});

test("point.create novo pode ser seguido por visibilidade e ordem na mesma proposal", () => {
  const point = op(
    "point.create",
    {
      tempId: "tmp-point-1",
      latitude: -21.77,
      longitude: -43.36,
      targetLayerId: "tmp_layer_points",
      targetDataId: "tmp_data_points",
      targetLabel: "Pontos adicionados",
      targetMode: "new",
      fieldMap: {
        latitude: "latitude",
        longitude: "longitude",
        name: "name",
        id: "maono_point_id",
      },
      properties: { name: "Novo ponto" },
      origin: "pin",
    },
    0,
  );
  const hide = op(
    "layer.visibility.update",
    {
      targetLayerId: "tmp_layer_points",
      targetDataId: "tmp_data_points",
      targetLabel: "Pontos adicionados",
      before: true,
      after: false,
    },
    1,
  );
  const reorder = op(
    "layer.order.update",
    {
      before: ["layer-a", "layer-b", "tmp_layer_points"],
      after: ["tmp_layer_points", "layer-a", "layer-b"],
    },
    2,
  );

  const proposal = buildProjectChangeProposal({
    baseConfig: baseConfig(),
    operations: [point, hide, reorder],
  });
  const created = proposal.config.config.visState.layers.find(
    (layer) => layer.id === "tmp_layer_points",
  );
  assert.ok(created);
  assert.equal(created.config.isVisible, false);
  assert.deepEqual(
    proposal.config.config.visState.layers.map((layer) => layer.id),
    ["tmp_layer_points", "layer-a", "layer-b"],
  );
});
