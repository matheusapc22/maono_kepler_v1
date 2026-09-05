import assert from "node:assert/strict";
import test from "node:test";

import { buildProjectChangeProposal } from "../functions/_lib/project-change-request-operations.js";
import {
  normalizeChangeRequestSubmission,
  PROJECT_CHANGE_OPERATION_REGISTRY,
} from "../functions/_lib/project-change-requests.js";

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
