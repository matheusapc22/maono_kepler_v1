import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  index: "../src/pages/Kepler/index.tsx",
  globalGrouping: "../src/pages/Kepler/components/point-cluster-settings-panel.tsx",
  groupingBridge: "../src/pages/Kepler/clustering/point-cluster-controller-bridge.tsx",
  groupingSection: "../src/pages/Kepler/components/maono-layer-panel/PointSpatialGroupingSection.tsx",
  inspector: "../src/pages/Kepler/components/maono-layer-panel/LayerInspector.tsx",
  styleEditor: "../src/pages/Kepler/components/maono-layer-panel/LayerStyleEditor.tsx",
  item: "../src/pages/Kepler/components/maono-layer-panel/LayerListItem.tsx",
  actionMenu: "../src/pages/Kepler/components/maono-layer-panel/PanelActionMenu.tsx",
  panel: "../src/pages/Kepler/components/maono-layer-panel/MaonoLayerPanel.tsx",
  saveAction: "../src/pages/Kepler/components/maono-layer-panel/PanelSaveAction.tsx",
  saveStyles: "../src/pages/Kepler/components/maono-layer-panel/panel-save-action.css",
  topbar: "../src/pages/Kepler/components/maono-map-shell/MapTopbar.tsx",
  topbarStyles: "../src/pages/Kepler/components/maono-map-shell/map-topbar-cleanup.css",
  clusteringHook: "../src/pages/Kepler/hooks/use-point-clustering.ts",
  clusteringController: "../src/pages/Kepler/clustering/point-cluster-controller.ts",
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

test("agrupamento espacial pertence à dimensão da camada sem accordion próprio", () => {
  assert.match(source.groupingSection, />Agrupamento espacial</);
  assert.match(source.groupingSection, /candidate\.pointLayerId === layerId/);
  assert.match(source.groupingSection, /controller\?\.updateLayerPolicy\([\s\S]*item\.pointLayerId/);
  assert.doesNotMatch(source.groupingSection, /useState|aria-expanded/);
  assert.match(source.groupingSection, /representação interna da mesma camada/);
  assert.match(source.inspector, /<PointSpatialGroupingSection/);
  assert.match(source.inspector, /dimensionAddon=\{grouping\}/);
  assert.match(source.styleEditor, />Dimensão e agrupamento</);
});

test("catálogo mantém apenas camadas lógicas e trata cluster como representação interna", () => {
  assert.match(source.clusteringHook, /LOGICAL_POINT_LAYER_TYPES\s*=\s*new Set\(\[\s*"point",\s*"geojson",\s*\]\)/);
  assert.match(source.clusteringHook, /minimumPointCount: 1/);
  assert.doesNotMatch(source.clusteringHook, /addLayer\(/);
  assert.doesNotMatch(source.clusteringHook, /layerToggleVisibility/);
  assert.doesNotMatch(source.clusteringHook, /pairedClusterLayerIds/);
  assert.doesNotMatch(source.clusteringHook, /startsWith\("maono-cluster-"\)/);
  assert.match(source.clusteringController, /LEGACY_CLUSTER_LAYER_PREFIX\s*=\s*"maono-cluster-"/);
  assert.match(source.clusteringController, /type === "point" \|\| type === "geojson"/);
  assert.match(source.clusteringController, /adaptiveClusterDeckLayerId/);
  assert.match(source.clusteringController, /removedClusterLayerIds/);
});

test("ações secundárias deixam a superfície e ficam em menu contextual", () => {
  assert.doesNotMatch(source.inspector, />\s*Duplicar\s*</);
  assert.doesNotMatch(source.inspector, />\s*Remover\s*</);
  assert.doesNotMatch(source.item, /maono-layer-list__actions/);
  assert.match(source.item, /label: "Duplicar"/);
  assert.match(source.item, /label: "Remover"/);
  assert.match(source.item, /onDuplicate\(layer\)/);
  assert.match(source.item, /onRemove\(layer\)/);
  assert.match(source.actionMenu, /role="menu"/);
  assert.match(source.panel, /window\.confirm/);
});

test("salvamento visível fica no rodapé fixo do painel e reutiliza executor existente", () => {
  assert.match(source.panel, /<PanelSaveAction \/>/);
  assert.match(source.saveAction, /"Salvar mapa"/);
  assert.match(source.saveAction, /"Salvando mapa…"/);
  assert.match(source.saveAction, /legacySaveButton\(\)\?\.click\(\)/);
  assert.match(source.saveAction, /capabilities\?\.saveMap/);
  assert.match(source.saveStyles, /\.maono-layer-panel__save-footer/);
  assert.match(source.saveStyles, /flex: 0 0 auto/);
  assert.match(source.saveStyles, /\[data-maono-no-preview="true"\]\.fixed\.bottom-6\.right-6[\s\S]*display: none !important/);
});

test("topbar não reserva seletor de projeto nem seta de retorno", () => {
  assert.doesNotMatch(source.topbar, /maono-map-topbar__project/);
  assert.doesNotMatch(source.topbar, /maono-map-topbar__back/);
  assert.doesNotMatch(source.topbar, /activeOrganization\?\.name/);
  assert.match(source.topbar, /maono-map-topbar__account/);
  assert.match(source.topbar, /hasUnsavedChanges/);
  assert.match(source.topbarStyles, /justify-content: flex-end/);
});
