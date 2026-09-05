import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectChangeProposal } from "../functions/_lib/project-change-request-operations.js";
import { normalizeAnalysisAwareChangeRequestSubmission } from "../functions/_lib/project-change-request-analysis-submission.js";

function layerSnapshot(id, label = id) {
  return {
    id,
    type: "point",
    dataIds: ["data-a"],
    label,
    isVisible: true,
    columns: {
      latitude: "latitude",
      longitude: "longitude",
      geojson: null,
      altitude: null,
    },
    style: {
      fillEnabled: true,
      opacity: 0.8,
      color: [47, 125, 244],
      colorField: null,
      colorScale: null,
      colorPalette: [],
      colorPaletteId: null,
      strokeEnabled: false,
      strokeColor: [47, 125, 244],
      strokeColorField: null,
      strokeColorScale: null,
      strokeColorPalette: [],
      strokeColorPaletteId: null,
      strokeOpacity: 1,
      strokeWidth: 1,
      pointRadius: 10,
      radiusField: null,
      radiusScale: null,
      radiusRange: null,
      clusterRadius: null,
      heatmapRadius: null,
    },
    visualChannels: {
      color: { field: null, scale: null },
      strokeColor: { field: null, scale: null },
      size: { field: null, scale: null },
      height: { field: null, scale: null },
    },
  };
}

function rawLayer(id, label = id) {
  return {
    id,
    type: "point",
    config: {
      dataId: "data-a",
      label,
      isVisible: true,
      color: [47, 125, 244],
      columns: { lat: "latitude", lng: "longitude", altitude: null },
      visConfig: {
        opacity: 0.8,
        filled: true,
        outline: false,
        strokeColor: [47, 125, 244],
        strokeOpacity: 1,
        thickness: 1,
        radius: 10,
      },
      colorField: null,
      colorScale: null,
      strokeColorField: null,
      strokeColorScale: null,
      sizeField: null,
      sizeScale: null,
      heightField: null,
      heightScale: null,
    },
  };
}

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
          ],
          allData: [[-21.76, -43.35]],
        },
      },
    ],
    config: {
      visState: {
        layers: [rawLayer("layer-a", "Leads"), rawLayer("layer-b", "Leads B")],
        layerOrder: ["layer-a", "layer-b"],
        filters: [],
      },
    },
  };
}

function op(type, payload, sequence = 0) {
  return {
    id: `op-${sequence}-${type}`,
    type,
    version: 1,
    sequence,
    payload,
    createdAt: "2026-09-05T23:00:00.000Z",
  };
}

function createOperation() {
  return op(
    "layer.create",
    { layer: layerSnapshot("layer-new", "Nova camada"), insertIndex: 1 },
    0,
  );
}

function duplicateOperation() {
  return op(
    "layer.duplicate",
    {
      sourceLayerId: "layer-a",
      source: layerSnapshot("layer-a", "Leads"),
      layer: layerSnapshot("layer-copy", "Leads (cópia)"),
      insertIndex: 1,
    },
    0,
  );
}

function removeOperation() {
  return op(
    "layer.remove",
    {
      targetLayerId: "layer-b",
      before: layerSnapshot("layer-b", "Leads B"),
      previousIndex: 1,
    },
    0,
  );
}

test("submission Viewer aceita create, duplicate e remove de layer", () => {
  const normalized = normalizeAnalysisAwareChangeRequestSubmission({
    baseRevision: 184,
    reason: "Ajustar estrutura do mapa",
    operations: [createOperation(), duplicateOperation(), removeOperation()],
  });
  assert.deepEqual(
    normalized.operations.map((operation) => operation.type),
    ["layer.create", "layer.duplicate", "layer.remove"],
  );
});

test("layer.create insere estrutura sem copiar dataset", () => {
  const original = baseConfig();
  const proposal = buildProjectChangeProposal({
    baseConfig: original,
    operations: [createOperation()],
  });
  assert.deepEqual(
    proposal.config.config.visState.layers.map((layer) => layer.id),
    ["layer-a", "layer-new", "layer-b"],
  );
  assert.deepEqual(proposal.config.config.visState.layerOrder, [
    "layer-a",
    "layer-new",
    "layer-b",
  ]);
  assert.equal(proposal.config.datasets.length, 1);
  assert.equal(original.config.visState.layers.length, 2);
});

test("layer.duplicate preserva ID proposto e reutiliza o mesmo dataset", () => {
  const proposal = buildProjectChangeProposal({
    baseConfig: baseConfig(),
    operations: [duplicateOperation()],
  });
  const copy = proposal.config.config.visState.layers.find(
    (layer) => layer.id === "layer-copy",
  );
  assert.ok(copy);
  assert.equal(copy.config.dataId, "data-a");
  assert.equal(proposal.config.datasets.length, 1);
  assert.deepEqual(proposal.config.config.visState.layerOrder, [
    "layer-a",
    "layer-copy",
    "layer-b",
  ]);
});

test("layer.remove remove somente a layer e preserva dataset", () => {
  const proposal = buildProjectChangeProposal({
    baseConfig: baseConfig(),
    operations: [removeOperation()],
  });
  assert.deepEqual(
    proposal.config.config.visState.layers.map((layer) => layer.id),
    ["layer-a"],
  );
  assert.deepEqual(proposal.config.config.visState.layerOrder, ["layer-a"]);
  assert.equal(proposal.config.datasets.length, 1);
  assert.equal(proposal.config.datasets[0].data.id, "data-a");
});

test("lifecycle compõe sequencialmente com estilo, visibilidade e ordem", () => {
  const create = createOperation();
  const style = op(
    "layer.style.update",
    {
      targetLayerId: "layer-new",
      targetDataId: "data-a",
      targetLabel: "Nova camada",
      changes: { opacity: 0.4 },
    },
    1,
  );
  const hide = op(
    "layer.visibility.update",
    {
      targetLayerId: "layer-new",
      targetDataId: "data-a",
      targetLabel: "Nova camada",
      before: true,
      after: false,
    },
    2,
  );
  const reorder = op(
    "layer.order.update",
    {
      before: ["layer-a", "layer-new", "layer-b"],
      after: ["layer-new", "layer-a", "layer-b"],
    },
    3,
  );
  const proposal = buildProjectChangeProposal({
    baseConfig: baseConfig(),
    operations: [create, style, hide, reorder],
  });
  const created = proposal.config.config.visState.layers.find(
    (layer) => layer.id === "layer-new",
  );
  assert.equal(created.config.visConfig.opacity, 0.4);
  assert.equal(created.config.isVisible, false);
  assert.deepEqual(
    proposal.config.config.visState.layers.map((layer) => layer.id),
    ["layer-new", "layer-a", "layer-b"],
  );
});

test("lifecycle falha fechado para dataset ausente e target conflitante", () => {
  const missingDataset = createOperation();
  missingDataset.payload.layer.dataIds = ["data-missing"];
  assert.throws(
    () =>
      buildProjectChangeProposal({
        baseConfig: baseConfig(),
        operations: [missingDataset],
      }),
    (error) => error.code === "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
  );

  const duplicate = duplicateOperation();
  duplicate.payload.layer.id = "layer-b";
  assert.throws(
    () =>
      buildProjectChangeProposal({
        baseConfig: baseConfig(),
        operations: [duplicate],
      }),
    (error) => error.code === "CHANGE_REQUEST_OPERATION_TARGET_CONFLICT",
  );
});

test("source/remove stale e dupla remoção viram conflito/missing", () => {
  const stale = duplicateOperation();
  stale.payload.source.style.opacity = 0.5;
  assert.throws(
    () =>
      buildProjectChangeProposal({
        baseConfig: baseConfig(),
        operations: [stale],
      }),
    (error) => error.code === "CHANGE_REQUEST_OPERATION_TARGET_CONFLICT",
  );

  const remove = removeOperation();
  assert.throws(
    () =>
      buildProjectChangeProposal({
        baseConfig: baseConfig(),
        operations: [remove, { ...remove, id: "op-remove-2", sequence: 1 }],
      }),
    (error) => error.code === "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
  );
});

test("payload com allData e versão futura são rejeitados", () => {
  const withRows = createOperation();
  withRows.payload.layer.allData = [[1, 2, 3]];
  assert.throws(
    () =>
      normalizeAnalysisAwareChangeRequestSubmission({
        baseRevision: 184,
        reason: "Inválido",
        operations: [withRows],
      }),
    (error) => error.code === "CHANGE_REQUEST_OPERATION_INVALID" || /inválid/i.test(error.message),
  );

  const future = createOperation();
  future.version = 2;
  assert.throws(
    () =>
      normalizeAnalysisAwareChangeRequestSubmission({
        baseRevision: 184,
        reason: "Versão futura",
        operations: [future],
      }),
    (error) => error.code === "CHANGE_REQUEST_OPERATION_VERSION_UNSUPPORTED",
  );
});
