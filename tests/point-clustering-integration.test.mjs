import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { DeckGLClusterLayer } from "@kepler.gl/deckgl-layers";

import {
  prepareSavedConfigForPointClustering,
} from "../src/pages/Kepler/clustering/point-cluster-controller.ts";
import {
  createCountedClusterLayer,
} from "../src/pages/Kepler/clustering/point-cluster-count-layer.ts";
import {
  getMaonoConfigForSave,
  getPointClusterSnapshot,
  loadPointClusterState,
  registerPointClusterPair,
  updatePointClusterLayerPolicy,
} from "../src/pages/Kepler/clustering/point-cluster-store.ts";

const policy = {
  enabled: true,
  clusterMaxZoom: 12,
  hysteresis: 0.25,
  clusterSize: 55,
  showCount: true,
};

function savedConfig() {
  return {
    version: "v1",
    datasets: [
      {
        version: "v1",
        data: {
          id: "dataset-estabelecimentos",
          allData: Array.from(
            { length: 250 },
            (_, index) => ({
              latitude: -23.5 + index / 10_000,
              longitude: -46.6 + index / 10_000,
              _geojson: {
                type: "Point",
                coordinates: [-46.6, -23.5],
              },
            }),
          ),
          fields: [],
        },
      },
    ],
    config: {
      visState: {
        layers: [
          {
            id: "estabelecimentos",
            type: "point",
            config: {
              dataId: "dataset-estabelecimentos",
              label: "Estabelecimentos",
              color: [10, 120, 110],
              columns: {
                lat: "latitude",
                lng: "longitude",
              },
              isVisible: true,
              visConfig: {
                opacity: 0.75,
              },
            },
            visualChannels: {
              colorField: null,
              colorScale: "quantize",
            },
          },
        ],
        filters: [
          {
            id: "filtro-categoria",
            dataId: ["dataset-estabelecimentos"],
          },
        ],
      },
      mapState: {
        zoom: 9,
      },
      interactionConfig: {
        tooltip: {
          fieldsToShow: {
            "dataset-estabelecimentos": [
              { name: "nome", format: null },
            ],
          },
        },
      },
    },
    maono: {
      existingExtension: {
        keep: true,
      },
      pointClustering: {
        version: 1,
        layers: {
          estabelecimentos: policy,
        },
      },
    },
  };
}

test("projeto legado permanece inalterado e sem par automático", () => {
  const legacy = savedConfig();
  delete legacy.maono.pointClustering;
  const prepared =
    prepareSavedConfigForPointClustering(legacy);

  assert.equal(prepared.savedConfig, legacy);
  assert.deepEqual(prepared.pairs, []);
  assert.equal(
    prepared.savedConfig.config.visState.layers.length,
    1,
  );
});

test("cria par idempotente sem copiar datasets, filtros ou tooltip", () => {
  const original = savedConfig();
  const prepared =
    prepareSavedConfigForPointClustering(original);
  const preparedAgain =
    prepareSavedConfigForPointClustering(
      prepared.savedConfig,
    );
  const layers =
    preparedAgain.savedConfig.config.visState.layers;

  assert.equal(layers.length, 2);
  assert.equal(
    layers.filter(
      (layer) =>
        layer.id ===
        "maono-cluster-estabelecimentos",
    ).length,
    1,
  );
  assert.equal(
    layers[1].config.dataId,
    "dataset-estabelecimentos",
  );
  assert.equal(
    prepared.savedConfig.datasets,
    original.datasets,
  );
  assert.equal(
    prepared.savedConfig.config.visState.filters,
    original.config.visState.filters,
  );
  assert.equal(
    prepared.savedConfig.config.interactionConfig,
    original.config.interactionConfig,
  );
});

test("reutiliza uma camada cluster manual compatível", () => {
  const original = savedConfig();
  original.config.visState.layers.push({
    id: "cluster-manual",
    type: "cluster",
    config: {
      dataId: "dataset-estabelecimentos",
      columns: {
        lat: "latitude",
        lng: "longitude",
      },
      isVisible: false,
      visConfig: {
        clusterRadius: 40,
      },
    },
    visualChannels: {
      colorField: null,
      colorScale: "quantize",
    },
  });
  const prepared =
    prepareSavedConfigForPointClustering(original);

  assert.equal(
    prepared.savedConfig.config.visState.layers.length,
    2,
  );
  assert.deepEqual(prepared.pairs, [
    {
      pointLayerId: "estabelecimentos",
      clusterLayerId: "cluster-manual",
    },
  ]);
});

test("cria par GeoJSON Point usando a coluna geométrica sem duplicar linhas", () => {
  const original = savedConfig();
  original.config.visState.layers[0] = {
    id: "estabelecimentos",
    type: "geojson",
    config: {
      dataId: "dataset-estabelecimentos",
      label: "Estabelecimentos",
      columns: {
        geojson: "_geojson",
      },
      isVisible: true,
      visConfig: {},
    },
    visualChannels: {
      colorField: null,
      colorScale: "quantize",
    },
  };

  const prepared =
    prepareSavedConfigForPointClustering(original);
  const cluster =
    prepared.savedConfig.config.visState.layers.find(
      (layer) =>
        layer.id ===
        "maono-cluster-estabelecimentos",
    );

  assert.deepEqual(cluster.config.columns, {
    geojson: "_geojson",
  });
  assert.equal(cluster.config.dataId, "dataset-estabelecimentos");
  assert.equal(prepared.savedConfig.datasets, original.datasets);
});

test("feature flag desativada restaura pontos para rollback imediato", () => {
  const original = savedConfig();
  const active =
    prepareSavedConfigForPointClustering(original);
  const prepared =
    prepareSavedConfigForPointClustering(
      active.savedConfig,
      {
        featureEnabled: false,
      },
    );
  const pointLayer =
    prepared.savedConfig.config.visState.layers.find(
      (layer) => layer.id === "estabelecimentos",
    );
  const clusterLayer =
    prepared.savedConfig.config.visState.layers.find(
      (layer) =>
        layer.id ===
        "maono-cluster-estabelecimentos",
    );

  assert.equal(pointLayer.config.isVisible, true);
  assert.equal(clusterLayer.config.isVisible, false);
});

test("volume acima de 300 mil não cria cluster client-side", () => {
  const original = savedConfig();
  original.datasets[0].data = {
    id: "dataset-estabelecimentos",
    length: 300_001,
    fields: [],
  };
  original.config.visState.layers[0].config.isVisible =
    false;

  const prepared =
    prepareSavedConfigForPointClustering(original);

  assert.equal(
    prepared.savedConfig.config.visState.layers.length,
    1,
  );
  assert.equal(
    prepared.savedConfig.config.visState.layers[0]
      .config.isVisible,
    true,
  );
});

test("store preserva outras extensões Maõno ao salvar", () => {
  const original = savedConfig();
  loadPointClusterState(original.maono);
  updatePointClusterLayerPolicy(
    "estabelecimentos",
    { clusterSize: 70 },
    150_000,
  );
  registerPointClusterPair({
    pointLayerId: "estabelecimentos",
    clusterLayerId:
      "maono-cluster-estabelecimentos",
  });

  const maono = getMaonoConfigForSave();
  const snapshot = getPointClusterSnapshot();

  assert.deepEqual(maono.existingExtension, {
    keep: true,
  });
  assert.equal(
    maono.pointClustering.layers.estabelecimentos
      .clusterSize,
    70,
  );
  assert.equal(snapshot.pairs.length, 1);
});

test("camada com contagem preserva os dados normalizados do deck.gl", () => {
  const data = Array.from({ length: 250 }, (_, index) => ({
    index,
  }));
  const getPosition = ({ index }) => [
    -45.43 + index / 10_000,
    -21.55 + index / 10_000,
  ];
  const nativeLayer = new DeckGLClusterLayer({
    id: "maono-cluster-estabelecimentos",
    data,
    getPosition,
    clusterRadius: 50,
    zoom: 8,
    width: 1_600,
    height: 900,
  });

  assert.equal(
    Object.prototype.propertyIsEnumerable.call(
      nativeLayer.props,
      "data",
    ),
    false,
  );

  const countedLayer = createCountedClusterLayer(nativeLayer);

  assert.equal(countedLayer.props.data, data);
  assert.equal(countedLayer.props.data.length, 250);
  assert.equal(countedLayer.props.getPosition, getPosition);
  assert.equal(countedLayer.props.clusterRadius, 50);
});

test("integração fonte conecta loader, save, painel e flag", async () => {
  const [
    loader,
    saveButton,
    hook,
    panel,
    reducer,
  ] = await Promise.all([
    readFile(
      new URL(
        "../src/pages/Kepler/map-url-loader/index.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/pages/Kepler/components/maono-save-button.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/pages/Kepler/hooks/use-point-clustering.ts",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/pages/Kepler/components/point-cluster-settings-panel.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL(
        "../src/pages/Kepler/reducers/index.ts",
        import.meta.url,
      ),
      "utf8",
    ),
  ]);

  assert.match(
    loader,
    /prepareSavedConfigForPointClustering/,
  );
  assert.match(loader, /loadPointClusterState/);
  assert.match(
    saveButton,
    /getMaonoConfigForSave/,
  );
  assert.match(
    hook,
    /VITE_POINT_CLUSTERING_V1/,
  );
  assert.match(
    hook,
    /layerToggleVisibility/,
  );
  assert.match(
    panel,
    /aria-label="Configurações de agrupamento de pontos"/,
  );
  assert.match(panel, /value=\{policy\.hysteresis\}/);
  assert.match(
    reducer,
    /cluster:\s*MaonoClusterLayer/,
  );
});
