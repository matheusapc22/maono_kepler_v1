import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProjectChangeProposal,
} from "../functions/_lib/project-change-request-operations.js";

function baseConfig() {
  return {
    version: "v1",
    datasets: [
      {
        version: "v1",
        data: {
          id: "leads",
          label: "Leads",
          color: [232, 184, 74],
          allData: [[-46.63, -23.55, "A"]],
          fields: [
            { name: "lng", type: "real", format: "", analyzerType: "FLOAT" },
            { name: "lat", type: "real", format: "", analyzerType: "FLOAT" },
            { name: "name", type: "string", format: "", analyzerType: "STRING" },
          ],
        },
      },
    ],
    config: {
      visState: {
        filters: [],
        layers: [
          {
            id: "leads-layer",
            type: "point",
            config: {
              dataId: "leads",
              label: "Leads",
              columns: { lat: "lat", lng: "lng", altitude: null },
              isVisible: true,
              visConfig: { radius: 10, opacity: 0.8, outline: false },
            },
          },
        ],
      },
    },
  };
}

function pointCreate(overrides = {}) {
  return {
    id: "op-1",
    sequence: 0,
    type: "point.create",
    version: 1,
    createdAt: "2026-09-05T12:00:00.000Z",
    payload: {
      tempId: "tmp-1",
      latitude: -15.78,
      longitude: -47.92,
      targetLayerId: "leads-layer",
      targetDataId: "leads",
      targetLabel: "Leads",
      fieldMap: {
        latitude: "lat",
        longitude: "lng",
        name: "name",
      },
      properties: {
        name: "ABC Telecom",
        email: "contato@abc.test",
        score: 9.5,
      },
      origin: "pin",
      ...overrides,
    },
  };
}

test("PR4: point.create reconstrói proposta sem mutar a REV base", () => {
  const base = baseConfig();
  const snapshot = JSON.stringify(base);
  const proposal = buildProjectChangeProposal({
    baseConfig: base,
    operations: [pointCreate()],
  });

  assert.equal(JSON.stringify(base), snapshot);
  assert.equal(proposal.operationCount, 1);
  assert.equal(proposal.projections[0].type, "point.create");
  assert.equal(proposal.projections[0].focus.latitude, -15.78);

  const dataset = proposal.config.datasets[0].data;
  assert.equal(dataset.allData.length, 2);
  assert.deepEqual(
    dataset.fields.map((field) => field.name),
    ["lng", "lat", "name", "email", "score"],
  );
  assert.deepEqual(dataset.allData[0], [-46.63, -23.55, "A", null, null]);
  assert.deepEqual(
    dataset.allData[1],
    [-47.92, -15.78, "ABC Telecom", "contato@abc.test", 9.5],
  );
});

test("PR4: nova target temporária cria dataset/layer determinísticos dentro do mesmo projeto", () => {
  const base = baseConfig();
  const first = pointCreate({
    targetMode: "new",
    targetDataId: "tmp_data_group",
    targetLayerId: "tmp_layer_group",
    targetLabel: "Pontos propostos",
    fieldMap: {
      latitude: "latitude",
      longitude: "longitude",
      name: "name",
      id: "maono_point_id",
    },
  });
  const second = {
    ...pointCreate({
      targetMode: "new",
      targetDataId: "tmp_data_group",
      targetLayerId: "tmp_layer_group",
      targetLabel: "Pontos propostos",
      fieldMap: {
        latitude: "latitude",
        longitude: "longitude",
        name: "name",
        id: "maono_point_id",
      },
      latitude: -16.1,
      longitude: -48.1,
      tempId: "tmp-2",
    }),
    id: "op-2",
    sequence: 1,
  };

  const proposal = buildProjectChangeProposal({ baseConfig: base, operations: [first, second] });
  const dataset = proposal.config.datasets.find((item) => item.data.id === "tmp_data_group");
  const layer = proposal.config.config.visState.layers.find((item) => item.id === "tmp_layer_group");

  assert.ok(dataset);
  assert.ok(layer);
  assert.equal(dataset.data.allData.length, 2);
  assert.equal(layer.config.dataId, "tmp_data_group");
});

test("PR4: target inexistente falha fechado como conflito de operação", () => {
  assert.throws(
    () =>
      buildProjectChangeProposal({
        baseConfig: baseConfig(),
        operations: [pointCreate({ targetDataId: "missing" })],
      }),
    (error) => {
      assert.equal(error.code, "CHANGE_REQUEST_OPERATION_TARGET_MISSING");
      assert.equal(error.details.operationId, "op-1");
      return true;
    },
  );
});
