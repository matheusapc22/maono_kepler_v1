import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  adaptiveClusterDeckLayerId,
  prepareSavedConfigForPointClustering,
  resolveClusterClick,
} from "../src/pages/Kepler/clustering/point-cluster-controller.ts";
import {
  POINT_CLUSTERING_VERSION,
  normalizePointClusteringExtension,
  resolvePointClusterMode,
} from "../src/pages/Kepler/clustering/point-cluster-policy.ts";
import {
  getMaonoConfigForSave,
  getPointClusterSnapshot,
  loadPointClusterState,
  prunePointClusterLayerPolicies,
} from "../src/pages/Kepler/clustering/point-cluster-store.ts";

function legacyConfig({ pointVisible, clusterVisible }) {
  return {
    datasets: [],
    maono: {
      audit: { source: "test" },
      pointClustering: {
        version: 1,
        layers: {
          points: {
            enabled: true,
            clusterMaxZoom: 12,
            hysteresis: 0.25,
            clusterSize: 50,
            showCount: true,
          },
        },
      },
    },
    config: {
      mapState: { zoom: 8 },
      visState: {
        layerOrder: ["maono-cluster-points", "points"],
        layers: [
          {
            id: "points",
            type: "point",
            config: {
              label: "Pontos",
              isVisible: pointVisible,
              dataId: "data",
              columns: { lat: "lat", lng: "lng" },
              visConfig: { opacity: 0.8 },
            },
          },
          {
            id: "maono-cluster-points",
            type: "cluster",
            config: {
              label: "Pontos · agrupado",
              isVisible: clusterVisible,
              dataId: "data",
              columns: { lat: "lat", lng: "lng" },
              visConfig: { clusterRadius: 64 },
            },
          },
        ],
      },
    },
  };
}

test("migração remove a camada derivada e preserva uma única visibilidade lógica", () => {
  const prepared = prepareSavedConfigForPointClustering(
    legacyConfig({ pointVisible: false, clusterVisible: true }),
  );

  assert.equal(prepared.migration.migrated, true);
  assert.deepEqual(prepared.migration.removedClusterLayerIds, [
    "maono-cluster-points",
  ]);
  assert.deepEqual(
    prepared.savedConfig.config.visState.layers.map((layer) => layer.id),
    ["points"],
  );
  assert.deepEqual(
    prepared.savedConfig.config.visState.layerOrder,
    ["points"],
  );
  assert.equal(
    prepared.savedConfig.config.visState.layers[0].config.isVisible,
    true,
  );
  assert.equal(
    prepared.savedConfig.maono.pointClustering.version,
    POINT_CLUSTERING_VERSION,
  );
  assert.equal(
    prepared.savedConfig.maono.pointClustering.layers.points.clusterSize,
    64,
  );
  assert.deepEqual(prepared.savedConfig.maono.audit, { source: "test" });
});

test("migração mantém a camada logicamente oculta quando as duas representações estavam ocultas", () => {
  const prepared = prepareSavedConfigForPointClustering(
    legacyConfig({ pointVisible: false, clusterVisible: false }),
  );

  assert.equal(
    prepared.savedConfig.config.visState.layers[0].config.isVisible,
    false,
  );
});

test("extensão antiga é normalizada e salva somente no contrato versão 2", () => {
  const normalized = normalizePointClusteringExtension({
    version: 1,
    layers: {
      points: { enabled: true },
    },
  });
  assert.equal(normalized.version, POINT_CLUSTERING_VERSION);

  loadPointClusterState({ pointClustering: normalized });
  assert.equal(
    getPointClusterSnapshot().extension.version,
    POINT_CLUSTERING_VERSION,
  );
  assert.equal(
    getMaonoConfigForSave()?.pointClustering.version,
    POINT_CLUSTERING_VERSION,
  );
});

test("políticas órfãs são removidas quando a camada lógica deixa de existir", () => {
  loadPointClusterState({
    pointClustering: {
      version: POINT_CLUSTERING_VERSION,
      layers: {
        points: { enabled: true },
        removed: { enabled: true },
      },
    },
  });

  assert.equal(prunePointClusterLayerPolicies(["points"]), true);
  assert.deepEqual(
    Object.keys(getPointClusterSnapshot().extension.layers),
    ["points"],
  );
});

test("alternância por zoom usa histerese sem alterar a visibilidade da camada", () => {
  const policy = {
    enabled: true,
    clusterMaxZoom: 12,
    hysteresis: 0.25,
    clusterSize: 50,
    showCount: true,
  };

  assert.equal(
    resolvePointClusterMode({ zoom: 11, policy }),
    "cluster",
  );
  assert.equal(
    resolvePointClusterMode({
      zoom: 12.1,
      previousMode: "cluster",
      policy,
    }),
    "cluster",
  );
  assert.equal(
    resolvePointClusterMode({
      zoom: 12.3,
      previousMode: "cluster",
      policy,
    }),
    "points",
  );
});

test("clique em subcamada interna de cluster aproxima a camada lógica original", () => {
  const runtimeId = adaptiveClusterDeckLayerId("points");
  const viewport = resolveClusterClick({
    clicked: {
      layer: { id: `${runtimeId}-cluster` },
      object: {
        position: [-46.63, -23.55],
        points: [{ index: 0 }, { index: 1 }],
      },
    },
    mapState: { zoom: 8 },
    extension: {
      version: POINT_CLUSTERING_VERSION,
      layers: {
        points: {
          enabled: true,
          clusterMaxZoom: 12,
          hysteresis: 0.25,
          clusterSize: 50,
          showCount: true,
        },
      },
    },
  });

  assert.deepEqual(viewport, {
    longitude: -46.63,
    latitude: -23.55,
    zoom: 10,
    transitionDuration: 350,
  });
});

test("runtime adaptativo não cria nem alterna camadas no Redux", async () => {
  const [hook, adaptive, reducer, loader, hydrator, store] = await Promise.all([
    readFile(
      new URL("../src/pages/Kepler/hooks/use-point-clustering.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/pages/Kepler/clustering/point-cluster-adaptive-layer.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/pages/Kepler/reducers/index.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/pages/Kepler/map-url-loader/index.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/pages/Kepler/map-url-loader/saved-config-hydrator.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/pages/Kepler/clustering/point-cluster-store.ts", import.meta.url),
      "utf8",
    ),
  ]);

  assert.doesNotMatch(hook, /\baddLayer\b/);
  assert.doesNotMatch(hook, /layerToggleVisibility/);
  assert.doesNotMatch(hook, /registerPointClusterPair/);
  assert.match(adaptive, /extends LayerClasses\.point/);
  assert.match(adaptive, /extends LayerClasses\.geojson/);
  assert.match(adaptive, /getPointClusterPolicy\(this\.id\)/);
  assert.match(reducer, /point:\s*MaonoAdaptivePointLayer/);
  assert.match(reducer, /geojson:\s*MaonoAdaptiveGeoJsonLayer/);
  assert.doesNotMatch(reducer, /cluster:\s*MaonoClusterLayer/);
  assert.match(loader, /hydrateSavedKeplerConfig/);
  assert.match(
    hydrator,
    /recoverOrphanedMaonoAnalysisReferences\(\s*prepared\.savedConfig,?\s*\)/,
  );
  assert.match(hydrator, /loadPointClusterState\(recovered\.savedConfig\.maono\)/);
  const recoveryIndex = hydrator.indexOf(
    "const recovered = recoverOrphanedMaonoAnalysisReferences",
  );
  const clusterStateIndex = hydrator.indexOf(
    "loadPointClusterState(recovered.savedConfig.maono)",
  );
  assert.ok(recoveryIndex >= 0 && clusterStateIndex > recoveryIndex);
  assert.doesNotMatch(loader, /prepared\.pairs/);
  assert.doesNotMatch(hydrator, /prepared\.pairs/);
  assert.doesNotMatch(store, /PointClusterPair|clusterLayerId|pairs:/);
});