import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { build } from "esbuild";
import ts from "typescript";

const files = {
  index: "../src/pages/Kepler/index.tsx",
  globalGrouping: "../src/pages/Kepler/components/point-cluster-settings-panel.tsx",
  groupingBridge: "../src/pages/Kepler/clustering/point-cluster-controller-bridge.tsx",
  groupingStore: "../src/pages/Kepler/clustering/point-cluster-controller-store.ts",
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
  assert.match(source.groupingBridge, /import \{ attachPointClusterController,[\s\S]*from "\.\/point-cluster-controller-store"/);
  assert.match(source.groupingBridge, /return attachPointClusterController\(controller\)/);
  assert.match(source.groupingStore, /useSyncExternalStore/);
  assert.match(source.index, /<PointClusterSettingsPanel controller=\{pointClustering\} \/>/);
});

test("entrada pública conecta ponte, store e hook reais sem soltar o controller mais recente", async () => {
  const entry = new URL('../src/pages/Kepler/clustering/point-cluster-controller-bridge.ts', import.meta.url);
  const bundled = await build({entryPoints: [fileURLToPath(entry)], bundle: true,
    platform: 'node', format: 'cjs', write: false, external: ['react']});
  const cleanups = [], dependencies = [];
  let snapshot;
  const reactBoundary = {
    useEffect(effect, deps) { dependencies.push(deps[0]); cleanups.push(effect()); },
    useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) {
      snapshot = {subscribe, getSnapshot, getServerSnapshot};
      return getSnapshot();
    },
  };
  const module = {exports: {}};
  vm.runInNewContext(bundled.outputFiles[0].text, {module, exports: module.exports, require(name) {
    assert.equal(name, 'react', 'only React scheduling is controlled; repository modules are bundled intact');
    return reactBoundary;
  }});
  const publicApi = module.exports;
  assert.equal(publicApi.usePointClusterController(), null);
  let notifications = 0;
  const unsubscribe = snapshot.subscribe(() => notifications++);
  const first = {id: 'first'}, second = {id: 'second'};
  assert.equal(publicApi.PointClusterControllerBridge({controller: first}), null);
  assert.equal(publicApi.usePointClusterController(), first);
  publicApi.PointClusterControllerBridge({controller: second});
  assert.equal(publicApi.usePointClusterController(), second);
  cleanups[0]();
  assert.equal(publicApi.usePointClusterController(), second, 'older cleanup cannot detach newer context');
  cleanups[1]();
  assert.equal(publicApi.usePointClusterController(), null);
  assert.equal(snapshot.getServerSnapshot(), null);
  assert.deepEqual(dependencies, [first, second]);
  assert.equal(notifications, 3);
  unsubscribe();
  publicApi.PointClusterControllerBridge({controller: first});
  assert.equal(notifications, 3, 'unmounted subscriber receives no notification');
  cleanups[2]();
});

test("os dois filtros reais de catálogo e limpeza excluem camadas internas e tipos ausentes", () => {
  const parsed = ts.createSourceFile('hook.ts', source.clusteringHook, ts.ScriptTarget.Latest, true);
  const declarations = [], predicates = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'LOGICAL_POINT_LAYER_TYPES') declarations.push(node);
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'filter' &&
      node.arguments[0]?.getText(parsed).includes('LOGICAL_POINT_LAYER_TYPES.has')) predicates.push(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(declarations.length, 1);
  assert.equal(predicates.length, 2, 'catalog and policy cleanup keep their real filters');
  const compile = text => ts.transpileModule(text, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
  const allowed = vm.runInNewContext(compile(`const allowed = ${declarations[0].initializer.getText(parsed)}; allowed;`));
  assert.deepEqual([...allowed], ['point', 'geojson']);
  const layers = [{id: 'point', type: 'point'}, {id: 'geojson', type: 'geojson'},
    {id: 'cluster', type: 'cluster'}, {id: 'heatmap', type: 'heatmap'}, {id: 'null', type: null}, {id: 'absent'}];
  for (const expression of predicates) {
    const predicate = vm.runInNewContext(compile(`const predicate = ${expression.getText(parsed)}; predicate;`), {LOGICAL_POINT_LAYER_TYPES: allowed});
    assert.deepEqual(layers.filter(predicate).map(layer => layer.id), ['point', 'geojson']);
  }
});

test("callback real preserva aridade, payload da política e solicitação de frame sem mudar o zoom", () => {
  const parsed = ts.createSourceFile('hook.ts', source.clusteringHook, ts.ScriptTarget.Latest, true);
  const matches = [];
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'updateLayerPolicy') matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(matches.length, 1);
  const callback = matches[0].initializer.arguments[0];
  const compiled = ts.transpileModule(`const callback = ${callback.getText(parsed)}; callback;`,
    {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
  const policyCalls = [], frameCalls = [];
  const update = vm.runInNewContext(compiled, {
    updatePointClusterLayerPolicy: (...args) => policyCalls.push(args),
    mapState: {zoom: 13}, updateMap: value => ({type: 'frame', zoom: value.zoom}),
    dispatch: action => frameCalls.push(action),
  });
  assert.equal(update.length, 3, 'original three-parameter runtime contract');
  const patch = {mode: 'adaptive'};
  update('points', patch, 250);
  update('geojson', patch);
  assert.deepEqual(policyCalls, [['points', patch, 250], ['geojson', patch, undefined]]);
  assert.equal(policyCalls[0][1], patch, 'patch identity is preserved');
  assert.deepEqual(frameCalls, [{type: 'frame', zoom: 13}, {type: 'frame', zoom: 13}]);
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
  const emitted = ts.transpileModule(source.clusteringHook, {compilerOptions: {target: ts.ScriptTarget.ES2022}}).outputText;
  assert.match(emitted, /LOGICAL_POINT_LAYER_TYPES\s*=\s*new Set\(\[\s*"point",\s*"geojson",\s*\]\)/);
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
  assert.match(source.saveAction, /aria-busy=\{state.primary\?\.busy \?\? false\}/);
  assert.match(source.saveAction, /invokeAction\("primary"\)/);
  assert.match(source.saveAction, /capabilities\?\.saveMap/);
  assert.match(source.saveStyles, /\.maono-layer-panel__save-footer/);
  assert.match(source.saveStyles, /flex: 0 0 auto/);
  assert.match(source.saveStyles, /\[data-maono-save-controller="true"\][\s\S]*display: none !important/);
  for (const action of ["support", "open-created"]) assert.ok(source.saveAction.includes(`"${action}"`));
  assert.doesNotMatch(source.saveAction, /export-current|export-attempt|archive-reviewed|stop-wait|retention/);
  assert.doesNotMatch(source.saveAction, /legacySaveButton|:scope > button/);
});

test("topbar não reserva seletor de projeto nem seta de retorno", () => {
  assert.doesNotMatch(source.topbar, /maono-map-topbar__project/);
  assert.doesNotMatch(source.topbar, /maono-map-topbar__back/);
  assert.doesNotMatch(source.topbar, /activeOrganization\?\.name/);
  assert.match(source.topbar, /maono-map-topbar__account/);
  assert.match(source.topbar, /hasUnsavedChanges/);
  assert.match(source.topbarStyles, /justify-content: flex-end/);
});
