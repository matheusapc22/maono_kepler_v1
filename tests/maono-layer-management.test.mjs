import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  fieldSupportsLayerColumn,
  keplerColumnsFromSnapshot,
  layerStructureForType,
  migrateLayerConfigurationForTypeChange,
  moveLayerId,
  planLayerColumnUpdate,
  planLayerDatasetAssociation,
  replacementLayerIdAfterRemoval,
  validateLayerColumns,
} from "../src/pages/Kepler/engine-adapter/layer-management.ts";
import { normalizeKeplerLayers } from "../src/pages/Kepler/engine-adapter/selectors.ts";

const fields = [
  { name: "latitude", type: "real", format: null, filterType: "range" },
  { name: "longitude", type: "real", format: null, filterType: "range" },
  { name: "altitude", type: "integer", format: null, filterType: "range" },
  { name: "categoria", type: "string", format: null, filterType: "multiSelect" },
];

const dataset = {
  id: "points",
  label: "Pontos",
  fields,
  rowCount: 2,
  filteredRowCount: 2,
  source: "csv",
  status: "ready",
  error: null,
  isVisible: true,
  isTransient: false,
  dependentLayerIds: ["layer-points"],
};

const alternateDataset = {
  ...dataset,
  id: "alternate",
  label: "Pontos alternativos",
  fields: [
    { name: "lat", type: "double", format: null, filterType: "range" },
    { name: "lng", type: "double", format: null, filterType: "range" },
  ],
  dependentLayerIds: [],
};

const invalidDataset = {
  ...dataset,
  id: "table",
  label: "Tabela sem geometria",
  fields: [
    { name: "categoria", type: "string", format: null, filterType: "multiSelect" },
  ],
  dependentLayerIds: [],
};

const rawLayer = {
  id: "layer-points",
  type: "point",
  config: {
    label: "Pontos comerciais",
    dataId: "points",
    isVisible: true,
    columns: { lat: "latitude", lng: "longitude", altitude: "altitude" },
    colorField: { name: "categoria" },
    sizeField: { name: "altitude" },
    visConfig: { opacity: 0.8, colorScale: "ordinal" },
  },
};

const layer = normalizeKeplerLayers([rawLayer], ["layer-points"])[0];

test("matriz estrutural limita troca aos tipos efetivamente gerenciados", () => {
  assert.deepEqual(layerStructureForType("point").availableTypeChanges, [
    "point",
    "cluster",
    "heatmap",
  ]);
  assert.deepEqual(layerStructureForType("geojson").availableTypeChanges, [
    "geojson",
  ]);
  assert.equal(layerStructureForType("arc").supported, false);
  assert.deepEqual(layer.structure.requiredColumns, ["latitude", "longitude"]);
});

test("columns são validadas pelo schema e pela combinação estrutural", () => {
  assert.deepEqual(validateLayerColumns("point", layer.columns, dataset), []);

  const duplicateCoordinates = validateLayerColumns(
    "point",
    { ...layer.columns, longitude: "latitude" },
    dataset,
  );
  assert.equal(
    duplicateCoordinates.some((item) => item.code === "DUPLICATE_COLUMN"),
    true,
  );

  const incompatible = validateLayerColumns(
    "point",
    { ...layer.columns, latitude: "categoria" },
    dataset,
  );
  assert.equal(
    incompatible.some((item) => item.code === "FIELD_TYPE_INCOMPATIBLE"),
    true,
  );
  assert.equal(fieldSupportsLayerColumn(fields[0], "latitude"), true);
  assert.equal(fieldSupportsLayerColumn(fields[3], "latitude"), false);
});

test("converte columns normalizadas para o contrato LayerColumns do Kepler", () => {
  assert.deepEqual(keplerColumnsFromSnapshot(layer.columns, dataset), {
    lat: { value: "latitude", fieldIdx: 0 },
    lng: { value: "longitude", fieldIdx: 1 },
    altitude: { value: "altitude", fieldIdx: 2, optional: true },
  });

  assert.deepEqual(
    keplerColumnsFromSnapshot(
      {
        latitude: null,
        longitude: null,
        geojson: "geometry",
        altitude: null,
      },
      {
        ...dataset,
        fields: [
          { name: "name", type: "string", format: null, filterType: "multiSelect" },
          { name: "geometry", type: "geojson", format: null, filterType: null },
        ],
      },
    ),
    { geojson: { value: "geometry", fieldIdx: 1 } },
  );
});

test("troca point/cluster/heatmap preserva dataset e columns compatíveis", () => {
  const plan = migrateLayerConfigurationForTypeChange(layer, "cluster", dataset);

  assert.equal(plan.valid, true);
  assert.equal(plan.changed, true);
  assert.equal(plan.datasetId, "points");
  assert.deepEqual(plan.columns, layer.columns);
  assert.deepEqual(plan.preservedColumns, [
    "latitude",
    "longitude",
    "altitude",
  ]);
  assert.equal(plan.preservedChannels.includes("color"), true);
  assert.equal(plan.removedChannels.includes("size"), true);

  const forbidden = migrateLayerConfigurationForTypeChange(
    layer,
    "geojson",
    dataset,
  );
  assert.equal(forbidden.valid, false);
  assert.equal(
    forbidden.issues.some((item) => item.code === "TYPE_CHANGE_NOT_ALLOWED"),
    true,
  );
});

test("associação de dataset preserva nomes compatíveis e infere novos campos", () => {
  const same = planLayerDatasetAssociation(layer, dataset);
  assert.equal(same.valid, true);
  assert.equal(same.changed, false);

  const alternate = planLayerDatasetAssociation(layer, alternateDataset);
  assert.equal(alternate.valid, true);
  assert.equal(alternate.changed, true);
  assert.equal(alternate.columns.latitude, "lat");
  assert.equal(alternate.columns.longitude, "lng");
  assert.equal(alternate.columns.altitude, null);

  const invalid = planLayerDatasetAssociation(layer, invalidDataset);
  assert.equal(invalid.valid, false);
  assert.equal(
    invalid.issues.filter((item) => item.code === "REQUIRED_COLUMN_MISSING")
      .length,
    2,
  );
});

test("atualização de columns é atômica, tipada e reconhece no-op", () => {
  const noOp = planLayerColumnUpdate(layer, dataset, {
    latitude: "latitude",
  });
  assert.equal(noOp.valid, true);
  assert.equal(noOp.changed, false);

  const changed = planLayerColumnUpdate(layer, dataset, {
    altitude: null,
  });
  assert.equal(changed.valid, true);
  assert.equal(changed.changed, true);
  assert.equal(changed.columns.altitude, null);

  const invalid = planLayerColumnUpdate(layer, dataset, {
    longitude: "categoria",
  });
  assert.equal(invalid.valid, false);
  assert.equal(
    invalid.issues.some((item) => item.code === "FIELD_TYPE_INCOMPATIBLE"),
    true,
  );
});

test("ordem e seleção substituta são determinísticas", () => {
  assert.deepEqual(moveLayerId(["a", "b", "c"], "c", 0), ["c", "a", "b"]);
  assert.deepEqual(moveLayerId(["a", "b", "c"], "b", 1), ["a", "b", "c"]);
  assert.equal(replacementLayerIdAfterRemoval(["a", "b", "c"], "b", "b"), "c");
  assert.equal(replacementLayerIdAfterRemoval(["a", "b"], "b", "b"), "a");
  assert.equal(replacementLayerIdAfterRemoval(["a"], "a", "a"), null);
  assert.equal(replacementLayerIdAfterRemoval(["a", "b"], "a", "b"), "b");
});

test("componentes visuais mantêm a fronteira do Engine Adapter", async () => {
  const paths = [
    "../src/pages/Kepler/components/maono-layer-panel/MaonoLayerPanel.tsx",
    "../src/pages/Kepler/components/maono-layer-panel/LayerList.tsx",
    "../src/pages/Kepler/components/maono-layer-panel/LayerListItem.tsx",
    "../src/pages/Kepler/components/maono-layer-panel/LayerInspector.tsx",
    "../src/pages/Kepler/components/maono-layer-panel/LayerStyleEditor.tsx",
  ];

  for (const path of paths) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /@kepler\.gl\/actions/);
    assert.doesNotMatch(source, /react-redux/);
    assert.doesNotMatch(source, /state\.demo\.keplerGl/);
  }
});
