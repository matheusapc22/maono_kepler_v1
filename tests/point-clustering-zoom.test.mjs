import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePointClusterMode,
} from "../src/pages/Kepler/clustering/point-cluster-policy.ts";
import {
  resolveClusterClick,
  adaptiveClusterDeckLayerId,
} from "../src/pages/Kepler/clustering/point-cluster-controller.ts";

import { DeckGLClusterLayer } from "@kepler.gl/deckgl-layers";
import { loadPointClusterRuntime, pointRenderOptions } from "./helpers/load-point-cluster-runtime.mjs";

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

test("zoom repetido mantém a representação sem alterar configuração lógica", async () => {
  const runtime = await loadPointClusterRuntime();
  runtime.loadPointClusterState({ pointClustering: { version: 2, layers: { point: policy } } });
  const layer = new runtime.MaonoAdaptivePointLayer({ id: "point" });
  const before = structuredClone(layer.config);
  const opts = pointRenderOptions([{ position: [0, 0] }, { position: [1, 1] }], 11);
  for (let repeat = 0; repeat < 3; repeat++) {
    const [cluster] = layer.renderLayer(opts);
    assert.ok(cluster instanceof DeckGLClusterLayer);
    assert.equal(cluster.id, adaptiveClusterDeckLayerId("point"));
    assert.deepEqual(layer.config, before);
  }
});

test("sequência de zoom atravessa histerese sem alternar visibilidade lógica", async () => {
  const runtime = await loadPointClusterRuntime();
  runtime.loadPointClusterState({ pointClustering: { version: 2, layers: { point: policy } } });
  const layer = new runtime.MaonoAdaptivePointLayer({ id: "point" });
  const before = structuredClone(layer.config);
  for (const [zoom, clustered] of [[11,true],[12.25,true],[12.26,false],[11.75,false],[11.74,true],[12,true]]) {
    const [rendered] = layer.renderLayer(pointRenderOptions([{ position: [0, 0] }], zoom));
    assert.equal(rendered instanceof DeckGLClusterLayer, clustered, `zoom=${zoom}`);
    assert.deepEqual(layer.config, before);
  }
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
        id: `${adaptiveClusterDeckLayerId("estabelecimentos")}-cluster`,
      },
      object: {
        position: [-46.63, -23.55],
        points: [{}, {}, {}],
      },
    },
    mapState: { zoom: 9 },
    extension: {
      version: 2,
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
        id: `${adaptiveClusterDeckLayerId("estabelecimentos")}-cluster`,
      },
      object: {
        position: [-46.63, -23.55],
        points: [{}],
      },
    },
    mapState: { zoom: 9 },
    extension: {
      version: 2,
      layers: {
        estabelecimentos: policy,
      },
    },
  });

  assert.equal(viewport, null);
});
