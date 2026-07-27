import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_CLIENT_POINT_COUNT,
  getAdaptivePointClusterDefaults,
  normalizePointClusteringExtension,
  pointClusterLayerId,
} from "../src/pages/Kepler/clustering/point-cluster-policy.ts";
import {
  getPointClusterEligibility,
} from "../src/pages/Kepler/clustering/point-cluster-eligibility.ts";

function pointLayer(overrides = {}) {
  return {
    id: "estabelecimentos",
    type: "point",
    config: {
      dataId: "dataset-estabelecimentos",
      columns: {
        lat: "latitude",
        lng: "longitude",
      },
      ...overrides,
    },
  };
}

test("normaliza configuração ausente sem ativar clustering", () => {
  assert.deepEqual(
    normalizePointClusteringExtension(undefined),
    {
      version: 1,
      layers: {},
    },
  );
});

test("aplica defaults seguros a configuração parcial", () => {
  const normalized = normalizePointClusteringExtension({
    version: 1,
    layers: {
      estabelecimentos: {
        enabled: true,
        clusterMaxZoom: 11.5,
      },
    },
  });

  assert.deepEqual(normalized.layers.estabelecimentos, {
    enabled: true,
    clusterMaxZoom: 11.5,
    hysteresis: 0.25,
    clusterSize: 50,
    showCount: true,
  });
});

test("ignora versão futura em vez de interpretar campos desconhecidos", () => {
  const normalized = normalizePointClusteringExtension({
    version: 2,
    layers: {
      estabelecimentos: {
        enabled: true,
      },
    },
  });

  assert.deepEqual(normalized.layers, {});
});

test("calcula defaults adaptativos por volume", () => {
  assert.deepEqual(getAdaptivePointClusterDefaults(10_000), {
    clusterMaxZoom: 11,
    clusterSize: 40,
    delivery: "safe",
  });
  assert.deepEqual(getAdaptivePointClusterDefaults(10_001), {
    clusterMaxZoom: 12,
    clusterSize: 55,
    delivery: "warn",
  });
  assert.deepEqual(getAdaptivePointClusterDefaults(100_001), {
    clusterMaxZoom: 13,
    clusterSize: 70,
    delivery: "warn",
  });
  assert.equal(
    getAdaptivePointClusterDefaults(
      MAX_CLIENT_POINT_COUNT + 1,
    ).delivery,
    "tile_required",
  );
});

test("gera ID determinístico para a camada emparelhada", () => {
  assert.equal(
    pointClusterLayerId("estabelecimentos"),
    "maono-cluster-estabelecimentos",
  );
});

test("aceita Point Layer com coordenadas e volume elegível", () => {
  const eligibility = getPointClusterEligibility(
    pointLayer(),
    {
      data: {
        allData: Array.from({ length: 250 }, () => ({})),
      },
    },
  );

  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.reason, "eligible");
  assert.equal(eligibility.pointCount, 250);
});

test("aceita GeoJSON contendo somente Point após validação", () => {
  const eligibility = getPointClusterEligibility(
    {
      id: "geo-points",
      type: "geojson",
      config: {
        dataId: "geo-dataset",
        columns: {
          geojson: "_geojson",
        },
      },
    },
    {
      data: Array.from({ length: 250 }, (_, index) => ({
        latitude: -23.5 + index / 10_000,
        longitude: -46.6 + index / 10_000,
        geometry: {
          type: "Point",
          coordinates: [-46.6, -23.5],
        },
      })),
    },
  );

  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.sourceKind, "geojson-point");
  assert.equal(eligibility.geoJsonColumn, "_geojson");
});

test("aceita GeoJSON Point serializado como texto", () => {
  const eligibility = getPointClusterEligibility(
    {
      id: "geo-points",
      type: "geojson",
      config: {
        dataId: "geo-dataset",
        columns: {
          geojson: "_geojson",
        },
      },
    },
    {
      data: Array.from({ length: 250 }, () => ({
        _geojson: JSON.stringify({
          type: "Point",
          coordinates: [-46.6, -23.5],
        }),
      })),
    },
  );

  assert.equal(eligibility.eligible, true);
  assert.equal(eligibility.sourceKind, "geojson-point");
});

test("rejeita GeoJSON misto, camada de linha e volume excessivo", () => {
  const mixed = getPointClusterEligibility(
    {
      id: "mixed",
      type: "geojson",
      config: {
        dataId: "mixed-data",
        columns: { lat: "lat", lng: "lng" },
      },
    },
    {
      data: [
        {
          geometry: {
            type: "Point",
            coordinates: [0, 0],
          },
        },
        {
          geometry: {
            type: "Polygon",
            coordinates: [],
          },
        },
      ],
    },
  );
  const line = getPointClusterEligibility(
    { id: "line", type: "line", config: {} },
    { length: 1_000 },
  );
  const excessive = getPointClusterEligibility(
    pointLayer(),
    { length: MAX_CLIENT_POINT_COUNT + 1 },
  );

  assert.equal(mixed.reason, "mixed_geometry");
  assert.equal(line.reason, "unsupported_layer");
  assert.equal(excessive.reason, "tile_required");
});

test("prioriza tile_required para GeoJSON acima do limite local", () => {
  const eligibility = getPointClusterEligibility(
    {
      id: "geo-large",
      type: "geojson",
      config: {
        dataId: "geo-large-data",
        columns: {
          geojson: "_geojson",
        },
      },
    },
    {
      length: MAX_CLIENT_POINT_COUNT + 1,
    },
  );

  assert.equal(eligibility.reason, "tile_required");
});

test("mantém camadas pequenas fora do clustering por padrão", () => {
  const eligibility = getPointClusterEligibility(
    pointLayer(),
    { length: 249 },
  );

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "below_minimum");
});

test("rejeita amostra com coordenadas majoritariamente inválidas", () => {
  const eligibility = getPointClusterEligibility(
    pointLayer(),
    {
      data: {
        allData: Array.from({ length: 250 }, (_, index) => ({
          latitude: index < 30 ? 100 : -23.5,
          longitude: -46.6,
        })),
      },
    },
  );

  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, "invalid_coordinates");
});
