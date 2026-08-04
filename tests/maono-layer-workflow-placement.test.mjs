import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  index: "../src/pages/Kepler/index.tsx",
  globalGrouping:
    "../src/pages/Kepler/components/point-cluster-settings-panel.tsx",
  groupingBridge:
    "../src/pages/Kepler/clustering/point-cluster-controller-bridge.tsx",
  groupingSection:
    "../src/pages/Kepler/components/maono-layer-panel/PointSpatialGroupingSection.tsx",
  inspector:
    "../src/pages/Kepler/components/maono-layer-panel/LayerInspector.tsx",
  item:
    "../src/pages/Kepler/components/maono-layer-panel/LayerListItem.tsx",
  panel:
    "../src/pages/Kepler/components/maono-layer-panel/MaonoLayerPanel.tsx",
  saveAction:
    "../src/pages/Kepler/components/maono-layer-panel/PanelSaveAction.tsx",
  saveStyles:
    "../src/pages/Kepler/components/maono-layer-panel/panel-save-action.css",
  topbar:
    "../src/pages/Kepler/components/maono-map-shell/MapTopbar.tsx",
  topbarStyles:
    "../src/pages/Kepler/components/maono-map-shell/map-topbar-cleanup.css",
  clusteringHook:
    "../src/pages/Kepler/hooks/use-point-clustering.ts",
  clusteringController:
    "../src/pages/Kepler/clustering/point-cluster-controller.ts",
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, path]) => [
      key,
      await readFile(new URL(path, import.meta.url), "utf8"),
    ]),
  ),
);

test("interface global de agrupamento é substituída por ponte sem botão flutuante", () => {
  assert.match(source.globalGrouping, /PointClusterControllerBridge/);
  assert.doesNotMatch(source.globalGrouping, /Agrupar pontos/);
  assert.doesNotMatch(source.globalGrouping, /point-cluster-settings-panel\.css/);
  assert.match(source.groupingBridge, /useSyncExternalStore/);
  assert.match(source.index, /<PointClusterSettingsPanel controller=\{pointClustering\} \/>/);
});

test("agrupamento espacial pertence à camada acionada e mantém gatilho habilitado", () => {
  assert.match(source.groupingSection, />Agrupamento espacial</);
  assert.match(
    source.groupingSection,
    /candidate\.pointLayerId === layerId/,
  );
  assert.match(
    source.groupingSection,
    /controller\?\.updateLayerPolicy\([\s\S]*item\.pointLayerId/,
  );
  assert.match(source.groupingSection, /aria-expanded=\{open\}/);
  assert.doesNotMatch(
    source.groupingSection.slice(
      source.groupingSection.indexOf("maono-point-spatial-grouping__trigger"),
      source.groupingSection.indexOf("maono-point-spatial-grouping__content"),
    ),
    /disabled=/,
  );
  assert.match(source.inspector, /<PointSpatialGroupingSection/);
  assert.match(source.inspector, /layerId=\{activeLayer\.id\}/);
});

test("catálogo aceita ponto, cluster e heatmap sem expor camadas auxiliares", () => {
  for (const type of ["point", "cluster", "heatmap", "geojson"]) {
    assert.match(source.clusteringHook, new RegExp(`"${type}"`));
  }
  assert.match(source.clusteringHook, /startsWith\("maono-cluster-"\)/);
  assert.match(source.clusteringHook, /pairedClusterLayerIds/);
  assert.match(source.clusteringHook, /minimumPointCount: 1/);
  assert.match(
    source.clusteringController,
    /\["point", "geojson", "cluster", "heatmap"\]/,
  );
  assert.match(
    source.clusteringController,
    /layer\?\.id !== pointLayer\?\.id/,
  );
});

test("ações textuais duplicadas saem do inspetor e ícones seguros permanecem", () => {
  assert.doesNotMatch(source.inspector, />\s*Duplicar\s*</);
  assert.doesNotMatch(source.inspector, />\s*Remover\s*</);
  assert.doesNotMatch(source.inspector, /maono-layer-inspector__actions/);
  assert.match(source.item, /title="Duplicar"/);
  assert.match(source.item, /title="Remover"/);
  assert.match(source.item, /onDuplicate\(layer\)/);
  assert.match(source.item, /onRemove\(layer\)/);
  assert.match(source.panel, /window\.confirm/);
});

test("salvamento visível fica no rodapé fixo do painel e reutiliza executor existente", () => {
  assert.match(source.panel, /<PanelSaveAction \/>/);
  assert.match(source.saveAction, />Salvar mapa</);
  assert.match(source.saveAction, /legacySaveButton\(\)\?\.click\(\)/);
  assert.match(source.saveAction, /capabilities\?\.saveMap/);
  assert.match(source.saveStyles, /\.maono-layer-panel__save-footer/);
  assert.match(source.saveStyles, /flex: 0 0 auto/);
  assert.match(
    source.saveStyles,
    /\[data-maono-no-preview="true"\]\.fixed\.bottom-6\.right-6[\s\S]*display: none !important/,
  );
});

test("topbar não reserva seletor de projeto nem seta de retorno", () => {
  assert.doesNotMatch(source.topbar, /maono-map-topbar__project/);
  assert.doesNotMatch(source.topbar, /maono-map-topbar__back/);
  assert.doesNotMatch(source.topbar, /activeOrganization\?\.name/);
  assert.match(source.topbar, /maono-map-topbar__account/);
  assert.match(source.topbar, /hasUnsavedChanges/);
  assert.match(source.topbarStyles, /justify-content: flex-end/);
});
