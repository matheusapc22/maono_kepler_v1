import assert from "node:assert/strict";
import test from "node:test";

import { MapFlightController } from "../src/pages/Kepler/engine-adapter/map-flight-controller.ts";
import {
  calculateNavigationBounds,
  easeInOutCubic,
  fitNavigationTarget,
  hasEffectiveFilter,
  interpolateViewport,
  normalizeLongitude,
  shortestLongitudeDelta,
  viewportNeedsFocus,
} from "../src/pages/Kepler/engine-adapter/map-navigation.ts";

const viewport = {
  longitude: -47.88,
  latitude: -15.79,
  zoom: 5,
  bearing: 0,
  pitch: 0,
  width: 1200,
  height: 800,
};

function rootState({
  rows,
  filteredIndex = rows.map((_, index) => index),
  visible = true,
}) {
  return {
    demo: {
      app: {
        isMapLoading: false,
        error: null,
      },
      keplerGl: {
        map: {
          visState: {
            layers: [
              {
                id: "points",
                type: "point",
                config: {
                  dataId: "dataset",
                  isVisible: visible,
                  columns: {
                    lat: "latitude",
                    lng: "longitude",
                  },
                },
              },
            ],
            datasets: new Map([
              [
                "dataset",
                {
                  id: "dataset",
                  fields: [
                    { name: "latitude" },
                    { name: "longitude" },
                  ],
                  allData: rows,
                  allIndexes: rows.map((_, index) => index),
                  filteredIndex,
                },
              ],
            ]),
            filters: [],
          },
          mapState: viewport,
        },
      },
    },
  };
}

test("curva de suavização permanece limitada e previsível", () => {
  assert.equal(easeInOutCubic(0), 0);
  assert.equal(easeInOutCubic(0.5), 0.5);
  assert.equal(easeInOutCubic(1), 1);

  for (let value = -0.1; value <= 1.1; value += 0.01) {
    const eased = easeInOutCubic(value);
    assert.ok(eased >= 0 && eased <= 1);
  }
});

test("longitude usa o menor caminho ao cruzar a antimeridiana", () => {
  assert.equal(shortestLongitudeDelta(179, -179), 2);
  assert.equal(shortestLongitudeDelta(-179, 179), -2);
  assert.equal(normalizeLongitude(181), -179);

  const halfway = interpolateViewport(
    { ...viewport, longitude: 179 },
    { ...viewport, longitude: -179, zoom: 7 },
    0.5,
  );

  assert.ok(Math.abs(Math.abs(halfway.longitude) - 180) < 0.001);
  assert.equal(halfway.zoom, 6);
});

test("bounds ignoram camada oculta e respeitam índices filtrados", () => {
  const rows = [
    [-15.79, -47.88],
    [-23.55, -46.63],
  ];

  assert.equal(
    calculateNavigationBounds(rootState({ rows, visible: false })),
    null,
  );

  const filtered = calculateNavigationBounds(
    rootState({ rows, filteredIndex: [1] }),
    { filteredOnly: true },
  );

  assert.ok(filtered);
  assert.ok(filtered.minLongitude < -46.63);
  assert.ok(filtered.maxLongitude > -46.63);
  assert.ok(filtered.minLatitude < -23.55);
  assert.ok(filtered.maxLatitude > -23.55);
});

test("bounds na antimeridiana cobrem o menor arco", () => {
  const bounds = calculateNavigationBounds(
    rootState({
      rows: [
        [10, 179],
        [11, -179],
      ],
    }),
  );

  assert.ok(bounds);
  assert.ok(bounds.maxLongitude - bounds.minLongitude < 5);
  assert.ok(bounds.maxLongitude > 180);
});

test("amostragem distribuída preserva extremos ao longo do dataset", () => {
  const rows = Array.from({ length: 2_000 }, (_, index) => [
    -20 + index / 10_000,
    -50 + index / 1_000,
  ]);
  rows[1_999] = [30, 70];

  const bounds = calculateNavigationBounds(rootState({ rows }), {
    maximumCoordinates: 500,
  });

  assert.ok(bounds);
  assert.equal(bounds.sampled, true);
  assert.ok(bounds.maxLongitude >= 70);
  assert.ok(bounds.maxLatitude >= 30);
});

test("detecção de filtro diferencia valor padrão de recorte efetivo", () => {
  const base = {
    id: "filter",
    index: 0,
    label: "valor",
    dataIds: ["dataset"],
    fieldNames: ["valor"],
    dataId: "dataset",
    fieldName: "valor",
    fieldType: "real",
    domainSize: 2,
    domainTruncated: false,
    step: 1,
    histogram: [],
    enabled: true,
    compatible: true,
    compatibilityReason: null,
  };

  assert.equal(
    hasEffectiveFilter([
      {
        ...base,
        type: "range",
        domain: [0, 100],
        value: [0, 100],
      },
    ]),
    false,
  );
  assert.equal(
    hasEffectiveFilter([
      {
        ...base,
        type: "range",
        domain: [0, 100],
        value: [20, 80],
      },
    ]),
    true,
  );
});

test("fit cria destino estável e diagnóstico identifica desalinhamento", () => {
  const bounds = {
    minLongitude: -48,
    minLatitude: -24,
    maxLongitude: -46,
    maxLatitude: -22,
    sampled: false,
  };
  const target = fitNavigationTarget(viewport, bounds);

  assert.ok(target);
  assert.equal(target.width, viewport.width);
  assert.equal(target.height, viewport.height);
  assert.equal(viewportNeedsFocus(viewport, target), true);
  assert.equal(viewportNeedsFocus(target, target), false);
});

test("controlador conclui, cancela e não deixa frames órfãos", () => {
  let now = 0;
  let nextId = 1;
  const callbacks = new Map();
  const frames = [];
  const snapshots = [];
  const cancellations = [];
  const completions = [];

  const scheduler = {
    now: () => now,
    request(callback) {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    cancel(id) {
      callbacks.delete(id);
    },
  };
  const runNext = (time) => {
    const [id, callback] = callbacks.entries().next().value;
    callbacks.delete(id);
    now = time;
    callback(time);
  };

  const controller = new MapFlightController({
    scheduler,
    onFrame: (value) => frames.push(value),
    onStateChange: (value) => snapshots.push(value),
    onComplete: (value) => completions.push(value),
    onCancel: (reason) => cancellations.push(reason),
  });
  const target = { ...viewport, longitude: -40, zoom: 8 };

  assert.equal(controller.start(viewport, target, 1_000), true);
  assert.equal(controller.state.active, true);
  runNext(500);
  assert.equal(frames.length, 1);
  assert.ok(frames[0].zoom > 5 && frames[0].zoom < 8);
  runNext(1_000);
  assert.equal(controller.state.active, false);
  assert.equal(completions.length, 1);
  assert.equal(callbacks.size, 0);

  controller.start(viewport, target, 1_000);
  assert.equal(controller.cancel("interaction"), true);
  assert.deepEqual(cancellations, ["interaction"]);
  assert.equal(callbacks.size, 0);
  assert.ok(snapshots.length >= 4);
});
