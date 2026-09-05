import assert from "node:assert/strict";
import test from "node:test";

import {
  compactViewerOperationsForLocalLayerRemoval,
  inferViewerDuplicateSource,
  snapshotViewerLifecycleLayer,
  validateViewerLayerCreatePayload,
  validateViewerLayerDuplicatePayload,
  validateViewerLayerRemovePayload,
} from "../src/pages/Kepler/change-requests/viewer-layer-lifecycle.ts";

function layer(id = "layer-a", label = "Leads", order = 0) {
  return {
    id,
    type: "point",
    label,
    order,
    selected: false,
    isVisible: true,
    dataIds: ["data-a"],
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
      compatibility: {},
    },
    visualChannels: {
      color: { field: null, scale: null },
      strokeColor: { field: null, scale: null },
      size: { field: null, scale: null },
      height: { field: null, scale: null },
    },
    compatibility: {},
    structure: {},
  };
}

function operation(type, payload, id = `op-${type}`) {
  return {
    id,
    type,
    version: 1,
    payload,
    createdAt: "2026-09-05T22:00:00.000Z",
  };
}

test("snapshot lifecycle é pequeno e exclui dados pesados", () => {
  const snapshot = snapshotViewerLifecycleLayer(layer());
  assert.ok(snapshot);
  assert.equal(snapshot.id, "layer-a");
  assert.deepEqual(snapshot.dataIds, ["data-a"]);
  assert.equal("allData" in snapshot, false);
  assert.equal("datasets" in snapshot, false);
  assert.equal("compatibility" in snapshot, false);
  assert.equal("structure" in snapshot, false);
});

test("validators aceitam create, duplicate e remove v1", () => {
  const source = snapshotViewerLifecycleLayer(layer("layer-a", "Leads", 0));
  const copy = snapshotViewerLifecycleLayer(layer("layer-copy", "Leads (cópia)", 1));
  assert.ok(source && copy);

  assert.doesNotThrow(() =>
    validateViewerLayerCreatePayload({ layer: copy, insertIndex: 1 }),
  );
  assert.doesNotThrow(() =>
    validateViewerLayerDuplicatePayload({
      sourceLayerId: source.id,
      source,
      layer: copy,
      insertIndex: 1,
    }),
  );
  assert.doesNotThrow(() =>
    validateViewerLayerRemovePayload({
      targetLayerId: source.id,
      before: source,
      previousIndex: 0,
    }),
  );
});

test("payload lifecycle rejeita allData e propriedades arbitrárias", () => {
  const snapshot = snapshotViewerLifecycleLayer(layer());
  assert.ok(snapshot);
  assert.throws(
    () =>
      validateViewerLayerCreatePayload({
        layer: { ...snapshot, allData: [[1, 2, 3]] },
        insertIndex: 0,
      }),
    /WORKING_COPY_OPERATION_INVALID/,
  );
});

test("duplicação encontra a origem estrutural sem depender do label", () => {
  const source = layer("layer-a", "Leads", 0);
  const other = {
    ...layer("layer-b", "Outro", 2),
    style: { ...layer().style, opacity: 0.5 },
  };
  const copy = layer("layer-copy", "Leads (cópia)", 1);
  const inferred = inferViewerDuplicateSource([source, other], copy, 1);
  assert.equal(inferred?.id, "layer-a");
});

test("create seguido de remove compacta lifecycle e operações dependentes", () => {
  const created = snapshotViewerLifecycleLayer(layer("layer-new", "Nova", 1));
  assert.ok(created);
  const operations = [
    operation("layer.create", { layer: created, insertIndex: 1 }, "op-create"),
    operation(
      "layer.style.update",
      {
        targetLayerId: "layer-new",
        targetDataId: "data-a",
        targetLabel: "Nova",
        changes: { opacity: 0.5 },
      },
      "op-style",
    ),
    operation(
      "layer.visibility.update",
      {
        targetLayerId: "layer-new",
        targetDataId: "data-a",
        targetLabel: "Nova",
        before: true,
        after: false,
      },
      "op-visible",
    ),
    operation(
      "layer.order.update",
      {
        before: ["layer-a", "layer-new", "layer-b"],
        after: ["layer-new", "layer-a", "layer-b"],
      },
      "op-order",
    ),
  ];

  const compacted = compactViewerOperationsForLocalLayerRemoval(
    operations,
    "layer-new",
  );
  assert.deepEqual(
    compacted.map((item) => item.type),
    ["layer.order.update"],
  );
  assert.deepEqual(compacted[0].payload, {
    before: ["layer-a", "layer-b"],
    after: ["layer-a", "layer-b"],
  });
});

test("remove de layer da revisão-base não é compactado", () => {
  const operationA = operation(
    "layer.style.update",
    {
      targetLayerId: "layer-a",
      targetDataId: "data-a",
      targetLabel: "Leads",
      changes: { opacity: 0.5 },
    },
    "op-style",
  );
  assert.deepEqual(
    compactViewerOperationsForLocalLayerRemoval([operationA], "layer-a"),
    [operationA],
  );
});
