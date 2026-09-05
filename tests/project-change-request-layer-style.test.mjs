import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectChangeProposal } from "../functions/_lib/project-change-request-operations.js";
import {
  normalizeChangeRequestSubmission,
  PROJECT_CHANGE_OPERATION_REGISTRY,
} from "../functions/_lib/project-change-requests.js";
import {
  normalizeAnalysisAwareChangeRequestSubmission,
} from "../functions/_lib/project-change-request-analysis-submission.js";

function baseConfig() {
  return {
    version: "v1",
    datasets: [
      {
        version: "v1",
        data: {
          id: "buffer-data",
          label: "Buffer radial · 500 m",
          fields: [{ name: "_geojson", type: "geojson", format: "" }],
          allData: [[{"type":"FeatureCollection","features":[]}]],
        },
      },
    ],
    config: {
      visState: {
        layers: [
          {
            id: "buffer-layer",
            type: "geojson",
            config: {
              dataId: "buffer-data",
              label: "Buffer radial · 500 m",
              color: [232, 197, 95],
              columns: { geojson: "_geojson" },
              isVisible: true,
              visConfig: {
                opacity: 0.8,
                filled: true,
                stroked: true,
                strokeColor: [197, 160, 89],
                strokeOpacity: 1,
                thickness: 1,
              },
            },
          },
        ],
      },
    },
  };
}

function styleOperation() {
  return {
    id: "op-style",
    sequence: 0,
    type: "layer.style.update",
    version: 1,
    createdAt: "2026-09-05T12:00:00.000Z",
    payload: {
      targetLayerId: "buffer-layer",
      targetDataId: "buffer-data",
      targetLabel: "Buffer radial · 500 m",
      changes: { fixedColor: [220, 20, 20] },
    },
  };
}

function analysisGeoJson(label = "Área proposta") {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { analysis_label: label, radius_label: "500 m" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [-43.36, -21.77],
              [-43.34, -21.77],
              [-43.34, -21.75],
              [-43.36, -21.75],
              [-43.36, -21.77],
            ],
          ],
        },
      },
    ],
  };
}

function bufferOperation() {
  return {
    id: "op-buffer-create",
    sequence: 0,
    type: "buffer.create",
    version: 1,
    createdAt: "2026-09-05T12:02:00.000Z",
    payload: {
      targetDataId: "analysis-buffer-data",
      targetLayerId: "layer_analysis-buffer-data",
      targetLabel: "Buffer · 1 origem · 1 buffer",
      geojson: analysisGeoJson("Buffer radial · 500 m"),
      source: "analysis",
      analysisKind: "buffer",
      parameters: {
        sessionId: "buffer-session-1",
        items: [
          {
            origin: { latitude: -21.76, longitude: -43.35 },
            inputUnit: "m",
            ranges: [500],
            rangesMeters: [500],
          },
        ],
      },
    },
  };
}

function isochroneOperation() {
  return {
    id: "op-isochrone-create",
    sequence: 2,
    type: "isochrone.create",
    version: 1,
    createdAt: "2026-09-05T12:03:00.000Z",
    payload: {
      targetDataId: "analysis-isochrone-data",
      targetLayerId: "layer_analysis-isochrone-data",
      targetLabel: "Análise: Caminhada · 10 min",
      geojson: analysisGeoJson("Isócrona caminhada · 10 min"),
      source: "analysis",
      analysisKind: "isochrone",
      parameters: {
        origin: { latitude: -21.76, longitude: -43.35 },
        metadata: {
          type: "time",
          mode: "walk",
          mode_source: "request",
          ranges: [10],
          provider: "mapbox",
        },
      },
    },
  };
}

test("registry e normalização aceitam layer.style.update v1 com contrato fechado", () => {
  assert.equal(PROJECT_CHANGE_OPERATION_REGISTRY["layer.style.update"].version, 1);
  const normalized = normalizeChangeRequestSubmission({
    baseRevision: 22,
    reason: "Ajustar destaque do buffer",
    operations: [styleOperation()],
  });
  assert.equal(normalized.operations[0].type, "layer.style.update");
  assert.deepEqual(normalized.operations[0].payload.changes.fixedColor, [220, 20, 20]);

  assert.throws(
    () =>
      normalizeChangeRequestSubmission({
        baseRevision: 22,
        reason: "Patch arbitrário",
        operations: [
          {
            ...styleOperation(),
            payload: {
              ...styleOperation().payload,
              changes: { reducerPatch: { anything: true } },
            },
          },
        ],
      }),
    (error) => error.code === "CHANGE_REQUEST_OPERATION_INVALID",
  );
});

test("layer.style.update reconstrói before/after e altera somente a proposal", () => {
  const original = baseConfig();
  const proposal = buildProjectChangeProposal({
    baseConfig: original,
    operations: [styleOperation()],
  });
  const layer = proposal.config.config.visState.layers[0];
  assert.deepEqual(layer.config.color, [220, 20, 20]);
  assert.deepEqual(original.config.visState.layers[0].config.color, [232, 197, 95]);
  assert.equal(proposal.projections[0].type, "layer.style.update");
  assert.deepEqual(proposal.projections[0].properties.before.fixedColor, [232, 197, 95]);
  assert.deepEqual(proposal.projections[0].properties.after.fixedColor, [220, 20, 20]);
});

test("point.create targetMode=new pode ser seguido por style update na mesma nova camada", () => {
  const pointOperation = {
    id: "op-point",
    sequence: 0,
    type: "point.create",
    version: 1,
    createdAt: "2026-09-05T12:00:00.000Z",
    payload: {
      tempId: "tmp-point-1",
      latitude: -21.76,
      longitude: -43.35,
      targetLayerId: "tmp_layer_group",
      targetDataId: "tmp_data_group",
      targetLabel: "Pontos adicionados",
      targetMode: "new",
      fieldMap: {
        latitude: "latitude",
        longitude: "longitude",
        name: "name",
        type: "type",
        description: "description",
        id: "maono_point_id",
      },
      properties: { name: "Novo ponto", type: "Lead", description: "" },
      origin: "pin",
    },
  };
  const styleNewLayer = {
    id: "op-style-new",
    sequence: 1,
    type: "layer.style.update",
    version: 1,
    createdAt: "2026-09-05T12:01:00.000Z",
    payload: {
      targetLayerId: "tmp_layer_group",
      targetDataId: "tmp_data_group",
      targetLabel: "Pontos adicionados",
      changes: { fixedColor: [20, 120, 220] },
    },
  };

  const proposal = buildProjectChangeProposal({
    baseConfig: baseConfig(),
    operations: [pointOperation, styleNewLayer],
  });
  const created = proposal.config.config.visState.layers.find(
    (layer) => layer.id === "tmp_layer_group",
  );
  assert.ok(created);
  assert.deepEqual(created.config.color, [20, 120, 220]);
  assert.equal(
    proposal.config.datasets.filter((dataset) => dataset.data?.id === "tmp_data_group").length,
    1,
  );
  assert.deepEqual(
    proposal.projections.map((projection) => projection.type),
    ["point.create", "layer.style.update"],
  );
});

test("style update em layer removida falha fechado como conflito de target", () => {
  const operation = styleOperation();
  operation.payload.targetLayerId = "missing-layer";
  assert.throws(
    () =>
      buildProjectChangeProposal({
        baseConfig: baseConfig(),
        operations: [operation],
      }),
    (error) => error.code === "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
  );
});

test("submission Viewer aceita Buffer e Isócrona congelados sem abrir save direto", () => {
  const normalized = normalizeAnalysisAwareChangeRequestSubmission({
    baseRevision: 22,
    reason: "Adicionar análises para revisão",
    operations: [bufferOperation(), isochroneOperation()],
  });
  assert.equal(normalized.baseRevision, 22);
  assert.deepEqual(
    normalized.operations.map((operation) => operation.type),
    ["buffer.create", "isochrone.create"],
  );
  assert.equal(normalized.operations[0].payload.analysisKind, "buffer");
  assert.equal(normalized.operations[1].payload.parameters.metadata.mode, "walk");
});

test("Buffer e Isócrona entram na proposal e style posterior pode atingir Buffer novo", () => {
  const buffer = bufferOperation();
  const style = {
    id: "op-buffer-style",
    sequence: 1,
    type: "layer.style.update",
    version: 1,
    createdAt: "2026-09-05T12:02:30.000Z",
    payload: {
      targetLayerId: buffer.payload.targetLayerId,
      targetDataId: buffer.payload.targetDataId,
      targetLabel: buffer.payload.targetLabel,
      changes: { fixedColor: [220, 20, 20] },
    },
  };
  const isochrone = isochroneOperation();
  const original = baseConfig();
  const proposal = buildProjectChangeProposal({
    baseConfig: original,
    operations: [buffer, style, isochrone],
  });

  assert.deepEqual(
    proposal.projections.map((projection) => projection.type),
    ["buffer.create", "layer.style.update", "isochrone.create"],
  );
  const bufferLayer = proposal.config.config.visState.layers.find(
    (layer) => layer.id === buffer.payload.targetLayerId,
  );
  const isoLayer = proposal.config.config.visState.layers.find(
    (layer) => layer.id === isochrone.payload.targetLayerId,
  );
  assert.ok(bufferLayer);
  assert.ok(isoLayer);
  assert.deepEqual(bufferLayer.config.color, [220, 20, 20]);
  assert.equal(bufferLayer.config.columns.geojson, "_geojson");
  assert.equal(
    proposal.config.datasets.filter((dataset) =>
      [buffer.payload.targetDataId, isochrone.payload.targetDataId].includes(dataset.data?.id),
    ).length,
    2,
  );
  assert.equal(proposal.projections[0].overlay.kind, "geojson");
  assert.equal(proposal.projections[2].properties.metadata.provider, "mapbox");
  assert.equal(original.config.visState.layers.length, 1);
});

test("análise com geometria inválida falha fechado antes da submissão", () => {
  const operation = bufferOperation();
  operation.payload.geojson.features[0].geometry.coordinates[0][0][0] = 999;
  assert.throws(
    () =>
      normalizeAnalysisAwareChangeRequestSubmission({
        baseRevision: 22,
        reason: "Geometria inválida",
        operations: [operation],
      }),
    (error) => error.code === "CHANGE_REQUEST_OPERATION_INVALID",
  );
});
