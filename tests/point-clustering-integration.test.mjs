import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DeckGLClusterLayer } from "@kepler.gl/deckgl-layers";
import { prepareSavedConfigForPointClustering } from "../src/pages/Kepler/clustering/point-cluster-controller.ts";
import { getMaonoConfigForSave, getPointClusterSnapshot, loadPointClusterState, updatePointClusterLayerPolicy } from "../src/pages/Kepler/clustering/point-cluster-store.ts";
import { loadPointClusterRuntime, pointRenderOptions } from "./helpers/load-point-cluster-runtime.mjs";

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

test("projeto legado permanece semanticamente inalterado e sem par automático", () => {
  const legacy = savedConfig();
  delete legacy.maono.pointClustering;
  const before = structuredClone(legacy);
  const prepared = prepareSavedConfigForPointClustering(legacy);
  assert.deepEqual(prepared.savedConfig, legacy);
  assert.deepEqual(legacy, before);
  assert.equal(prepared.migration.migrated, false);
  assert.equal(prepared.savedConfig.config.visState.layers.length, 1);
});

test("migra par legado idempotentemente sem copiar datasets, filtros ou tooltip", () => {
  const original = savedConfig();
  original.config.visState.layers.push({
    id: "maono-cluster-estabelecimentos", type: "cluster",
    config: { dataId: "dataset-estabelecimentos", isVisible: true, visConfig: { clusterRadius: 55 } },
  });
  original.config.visState.layerOrder = ["maono-cluster-estabelecimentos", "estabelecimentos"];
  const before = structuredClone(original);
  const prepared = prepareSavedConfigForPointClustering(original);
  const again = prepareSavedConfigForPointClustering(prepared.savedConfig);
  assert.deepEqual(again.savedConfig, prepared.savedConfig);
  assert.deepEqual(original, before);
  assert.equal(prepared.migration.migrated, true);
  assert.equal(again.migration.migrated, false);
  assert.deepEqual(again.savedConfig.config.visState.layers.map(layer => layer.id), ["estabelecimentos"]);
  assert.deepEqual(again.savedConfig.config.visState.layerOrder, ["estabelecimentos"]);
  assert.equal(prepared.savedConfig.datasets, original.datasets);
  assert.equal(prepared.savedConfig.config.visState.filters, original.config.visState.filters);
  assert.equal(prepared.savedConfig.config.interactionConfig, original.config.interactionConfig);
});

test("preserva camada cluster manual independente da camada adaptativa", () => {
  const original = savedConfig();
  const manual = {
    id: "cluster-manual", type: "cluster",
    config: { dataId: "dataset-estabelecimentos", isVisible: false, visConfig: { clusterRadius: 40 } },
  };
  original.config.visState.layers.push(manual);
  const prepared = prepareSavedConfigForPointClustering(original);
  assert.equal(prepared.savedConfig.config.visState.layers.length, 2);
  assert.deepEqual(prepared.savedConfig.config.visState.layers[1], manual);
  assert.equal(prepared.migration.migrated, false);
  assert.deepEqual(Object.keys(prepared.extension.layers), ["estabelecimentos"]);
});

test("GeoJSON Point usa a coluna geométrica real sem duplicar camada ou linhas", async () => {
  const original = savedConfig();
  original.config.visState.layers[0].type = "geojson";
  original.config.visState.layers[0].config.columns = { geojson: "_geojson" };
  const prepared = prepareSavedConfigForPointClustering(original);
  assert.equal(prepared.savedConfig.datasets, original.datasets);
  assert.equal(prepared.savedConfig.config.visState.layers.length, 1);
  assert.deepEqual(prepared.savedConfig.config.visState.layers[0].config.columns, { geojson: "_geojson" });
  const runtime = await loadPointClusterRuntime();
  runtime.loadPointClusterState(prepared.savedConfig.maono);
  const layer = new runtime.MaonoAdaptiveGeoJsonLayer({ id: "estabelecimentos" });
  const data = original.datasets[0].data.allData.map(row => row._geojson);
  const [cluster] = layer.renderLayer(pointRenderOptions(data));
  assert.ok(cluster instanceof DeckGLClusterLayer);
  assert.deepEqual(cluster.props.data, data);
  assert.equal(cluster.props.data[0], data[0]);
  assert.deepEqual(cluster.props.getPosition(data[0]), [-46.6, -23.5]);
});

test("feature flag desativada renderiza pontos nativos e preserva política para rollback", async () => {
  const runtime = await loadPointClusterRuntime("false");
  const original = savedConfig();
  runtime.loadPointClusterState(original.maono);
  const layer = new runtime.MaonoAdaptivePointLayer({ id: "estabelecimentos" });
  const data = [{ position: [-46.6, -23.5] }];
  const rendered = layer.renderLayer(pointRenderOptions(data)).flat(Infinity).filter(Boolean);
  assert.ok(rendered.length > 0);
  assert.ok(rendered.every(item => !(item instanceof DeckGLClusterLayer)));
  assert.equal(rendered[0].props.data, data);
  assert.equal(layer.config.isVisible, true);
  assert.equal(runtime.getMaonoConfigForSave().pointClustering.layers.estabelecimentos.enabled, true);
});

test("volume acima de 300 mil usa pontos nativos sem mudar visibilidade lógica", async () => {
  const runtime = await loadPointClusterRuntime();
  runtime.loadPointClusterState(savedConfig().maono);
  const layer = new runtime.MaonoAdaptivePointLayer({ id: "estabelecimentos" });
  layer.config.isVisible = false;
  const data = Array.from({ length: 300_001 }, () => ({ position: [-46.6, -23.5] }));
  const rendered = layer.renderLayer(pointRenderOptions(data)).flat(Infinity).filter(Boolean);
  assert.ok(rendered.length > 0);
  assert.ok(rendered.every(item => !(item instanceof DeckGLClusterLayer)));
  assert.equal(rendered[0].props.data, data);
  assert.equal(layer.config.isVisible, false);
});

test("store preserva outras extensões Maõno ao salvar no contrato versão 2", () => {
  const original = savedConfig();
  loadPointClusterState(original.maono);
  updatePointClusterLayerPolicy("estabelecimentos", { clusterSize: 70 }, 150_000);
  const maono = getMaonoConfigForSave();
  assert.deepEqual(maono.existingExtension, { keep: true });
  assert.equal(maono.pointClustering.version, 2);
  assert.equal(maono.pointClustering.layers.estabelecimentos.clusterSize, 70);
  assert.equal(getPointClusterSnapshot().extension, maono.pointClustering);
  assert.equal(original.maono.pointClustering.layers.estabelecimentos.clusterSize, 55);
});

test("camada com contagem preserva dados e accessors normalizados reais do deck.gl", async () => {
  const runtime = await loadPointClusterRuntime();
  runtime.loadPointClusterState(savedConfig().maono);
  const layer = new runtime.MaonoAdaptivePointLayer({ id: "estabelecimentos" });
  const data = Array.from({ length: 250 }, (_, index) => ({ position: [-45.43 + index / 10_000, -21.55], index }));
  const opts = pointRenderOptions(data);
  const [counted] = layer.renderLayer(opts);
  assert.ok(counted instanceof runtime.MaonoCountedDeckClusterLayer);
  assert.ok(counted instanceof DeckGLClusterLayer);
  assert.equal(Object.prototype.propertyIsEnumerable.call(counted.props, "data"), false);
  assert.deepEqual(counted.props.data, data);
  assert.equal(counted.props.data[0], data[0]);
  assert.equal(counted.props.getPosition, opts.data.getPosition);
  assert.equal(counted.props.clusterRadius, 55);
  assert.deepEqual(counted.props.radiusRange, [1, 40]);
});

test("integração fonte conecta loader, save, painel, runtime e flag sem camadas Redux extras", async () => {
  const files = ["map-url-loader/index.tsx", "components/maono-save-button.tsx", "hooks/use-point-clustering.ts", "components/maono-layer-panel/PointSpatialGroupingSection.tsx", "reducers/index.ts", "clustering/point-cluster-adaptive-layer.ts", "map-url-loader/saved-config-hydrator.ts", "components/point-cluster-settings-panel.tsx"];
  const [loader, saveButton, hook, panel, reducer, adaptive, hydrator, bridge] = await Promise.all(files.map(file => readFile(new URL(`../src/pages/Kepler/${file}`, import.meta.url), "utf8")));
  assert.match(loader, /hydrateSavedKeplerConfig\(savedConfig,/);
  assert.match(hydrator, /prepareSavedConfigForPointClustering\(savedConfig,/);
  assert.match(loader, /loadPointClusterState/);
  assert.match(saveButton, /getMaonoConfigForSave/);
  assert.match(adaptive, /VITE_POINT_CLUSTERING_V1/);
  assert.doesNotMatch(hook, /layerToggleVisibility|registerPointClusterPair/);
  assert.match(bridge, /<PointClusterControllerBridge controller=\{controller\}/);
  assert.match(panel, /usePointClusterController\(\)/);
  assert.match(panel, /value=\{policy\.hysteresis\}/);
  assert.match(reducer, /point:\s*MaonoAdaptivePointLayer/);
  assert.match(reducer, /geojson:\s*MaonoAdaptiveGeoJsonLayer/);
});
