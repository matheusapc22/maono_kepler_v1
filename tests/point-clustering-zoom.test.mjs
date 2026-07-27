import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePointClusterMode,
} from "../src/pages/Kepler/clustering/point-cluster-policy.ts";
import {
  resolveClusterClick,
  resolveVisibilityChanges,
} from "../src/pages/Kepler/clustering/point-cluster-controller.ts";

const policy = {
  enabled: true,
  clusterMaxZoom: 12,
  hysteresis: 0.25,
  clusterSize: 50,
  showCount: true,
};

test("mantém cluster dentro da banda superior de histerese", () => {
  assert.equal(
    resolvePointClusterMode({
      zoom: 12.2,
      previousMode: "cluster",
      policy,
    }),
    "cluster",
  );
  assert.equal(
    resolvePointClusterMode({
      zoom: 12.26,
      previousMode: "cluster",
      policy,
    }),
    "points",
  );
});

test("mantém pontos dentro da banda inferior de histerese", () => {
  assert.equal(
    resolvePointClusterMode({
      zoom: 11.8,
      previousMode: "points",
      policy,
    }),
    "points",
  );
  assert.equal(
    resolvePointClusterMode({
      zoom: 11.74,
      previousMode: "points",
      policy,
    }),
    "cluster",
  );
});

test("não gera dispatch quando visibilidades já representam o modo", () => {
  const result = resolveVisibilityChanges({
    pointLayer: {
      id: "point",
      config: { isVisible: false },
    },
    clusterLayer: {
      id: "cluster",
      config: { isVisible: true },
    },
    zoom: 11,
    previousMode: "cluster",
    policy,
  });

  assert.equal(result.nextMode, "cluster");
  assert.deepEqual(result.changes, []);
});

test("alterna exatamente as duas camadas quando cruza o limiar", () => {
  const result = resolveVisibilityChanges({
    pointLayer: {
      id: "point",
      config: { isVisible: false },
    },
    clusterLayer: {
      id: "cluster",
      config: { isVisible: true },
    },
    zoom: 12.3,
    previousMode: "cluster",
    policy,
  });

  assert.equal(result.nextMode, "points");
  assert.deepEqual(result.changes, [
    { layerId: "cluster", isVisible: false },
    { layerId: "point", isVisible: true },
  ]);
});

test("política desativada sempre volta para pontos individuais", () => {
  const disabled = { ...policy, enabled: false };

  assert.equal(
    resolvePointClusterMode({
      zoom: 3,
      previousMode: "cluster",
      policy: disabled,
    }),
    "points",
  );
});

test("clique em cluster centraliza e aumenta o zoom", () => {
  const viewport = resolveClusterClick({
    clicked: {
      layer: {
        id: "maono-cluster-estabelecimentos-cluster",
      },
      object: {
        position: [-46.63, -23.55],
        points: [{}, {}, {}],
      },
    },
    mapState: { zoom: 9 },
    pairs: [
      {
        pointLayerId: "estabelecimentos",
        clusterLayerId:
          "maono-cluster-estabelecimentos",
      },
    ],
    extension: {
      version: 1,
      layers: {
        estabelecimentos: policy,
      },
    },
  });

  assert.deepEqual(viewport, {
    longitude: -46.63,
    latitude: -23.55,
    zoom: 11,
    transitionDuration: 350,
  });
});

test("clique em ponto único não altera o viewport", () => {
  const viewport = resolveClusterClick({
    clicked: {
      layer: {
        id: "maono-cluster-estabelecimentos-cluster",
      },
      object: {
        position: [-46.63, -23.55],
        points: [{}],
      },
    },
    mapState: { zoom: 9 },
    pairs: [
      {
        pointLayerId: "estabelecimentos",
        clusterLayerId:
          "maono-cluster-estabelecimentos",
      },
    ],
    extension: {
      version: 1,
      layers: {
        estabelecimentos: policy,
      },
    },
  });

  assert.equal(viewport, null);
});
