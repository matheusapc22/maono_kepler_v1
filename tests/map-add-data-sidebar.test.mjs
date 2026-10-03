import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import postcss from 'postcss';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const base = 'src/pages/Kepler/';
const ui = read(`${base}components/maono-map-shell/AddDataSidebar.tsx`);
const runtime = read(`${base}components/maono-map-shell/MaonoMapRuntime.tsx`);
const dialog = read(`${base}factories/add-data-dialog.tsx`);
const sources = read(`${base}factories/load-data-modal.ts`);
const styles = read(`${base}components/maono-map-shell/maono-map-data-sidebar.css`);

test('data catalog is genuinely empty, typed and has no fabricated retrieval', () => {
  assert.match(ui, /AVAILABLE_MAONO_DATASETS: readonly MaonoDataset\[\] = \[\]/);
  assert.match(ui, /Bases e dados oficiais disponibilizados pela Maõno\./);
  assert.match(ui, /Nenhuma fonte disponível no momento\./);
  assert.match(ui, /\.includes\(query\.trim\(\)/);
  assert.doesNotMatch(ui, /\bfetch\(|\/api\/|Limites Territoriais|Infraestrutura|Base Imobiliária|Armazenamento/);
});
test('source tabs have exact order, initial selection, keyboard and ARIA contracts', () => {
  assert.deepEqual([...ui.matchAll(/id: "(maono|files|tileset|url)", label: "([^"]+)"/g)].map(match => match[2]), ['Dados Maõno', 'Arquivos', 'Tileset', 'URL']);
  assert.match(ui, /useState<SourceId>\("maono"\)/);
  for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) assert.ok(ui.includes(`"${key}"`));
  for (const attribute of ['role="tablist"', 'role="tab"', 'role="tabpanel"', 'aria-selected=', 'aria-controls=', 'aria-labelledby=', 'aria-label="Fechar painel"']) assert.ok(ui.includes(attribute));
});
test('native ModalContainer handlers are retained and only the Add Data dialog shell is diverted', () => {
  assert.match(dialog, /props\.title === "modal.title.addDataToMap"/);
  assert.match(dialog, /props\.isOpen && dock\.enabled && dock\.target/);
  assert.match(dialog, /createPortal\(props\.children, dock\.target\)/);
  assert.match(dialog, /return <DefaultDialog \{\.\.\.props\} \/>/);
  assert.doesNotMatch(dialog, /loadFiles|updateVisData|fetch\(/);
  assert.match(read(`${base}index.tsx`), /replaceAddDataDialog\(\)/);
});
test('Arquivos and Tileset reuse native factory source components, URL keeps existing thunk', () => {
  assert.match(sources, /LoadDataModalFactory\(\.\.\.deps\)/);
  assert.match(sources, /method\.id === "upload"\)\.elementType/);
  assert.match(sources, /method\.id === "tileset"\)\.elementType/);
  assert.match(sources, /React\.createElement\(FileUpload, \{ \.\.\.props, fileLoadingProgress: localizeImportProgress/);
  assert.match(sources, /React\.createElement\(LocalizedLoadTilesetTab, sourceProps\)/);
  assert.match(sources, /React\.createElement\(LoadRemoteMap, sourceProps\)/);
  assert.match(sources, /onLoadRemoteMap: loadRemoteMap/);
  assert.doesNotMatch(sources, /id: "storage"|SampleMapGallery|processGeojson|processCsv|new File/);
});
test('manual selection is keyboard-accessible and dispatches through the existing input', () => {
  assert.match(sources, /React\.createElement\("button",/);
  assert.match(sources, /querySelector\('input\[type="file"\]'\)/);
  assert.match(sources, /input\.value = ""; input\.click\(\)/);
  assert.match(sources, /Selecionar arquivo/);
});
test('rail preserves database icon, toggles same Redux request and follows permissions', () => {
  const rail = read(`${base}components/maono-map-shell/MapSidebar.tsx`);
  assert.match(rail, /<MapShellIcon name="data" \/>/);
  assert.match(rail, /aria-expanded=\{panelOpen && activePanel === "data"\}/);
  assert.match(rail, /aria-controls="map-add-data-sidebar"/);
  assert.match(runtime, /currentModal === "addData"/);
  assert.match(runtime, /context\?\.capabilities\.importData/);
  assert.match(runtime, /wrapTo\("map", toggleModal\(null\)\)/);
  assert.match(runtime, /if \(dataRequested\) \{ closePanel\(\); return; \}/);
});
test('authorized import survives its own loading, while project hydration remains guarded', () => {
  const loader = read(`${base}map-url-loader/index.tsx`);
  assert.match(runtime, /!loadInteractionBlocked \|\| validDataSession/);
  assert.match(loader, /currentModal === "addData" && \(!projectSlug \|\| loadCycleComplete\)/);
  assert.match(sources, /if \(!dock\.enabled\) return null/);
  assert.match(sources, /busy: Boolean\(props\.isMapLoading \|\| props\.fileLoading\)/);
  assert.match(sources, /if \(props\.isMapLoading\)\s*\{\s*return null/);
});
test('removes only account/status presentation, keeping save/session and right map controls', () => {
  assert.match(runtime, /topbar=\{null\}/);
  assert.doesNotMatch(runtime, /<MapTopbar/);
  for (const kept of ['map_save_succeeded', 'markClean()', 'await logout()', '<MapOverlayControls />', '<PointFromPinWorkflow />']) assert.ok(runtime.includes(kept));
  assert.match(runtime, /\{children\}/);
});
test('data has no host backdrop or floating modal geometry', () => {
  assert.match(read(`${base}components/maono-map-shell/MapPanelHost.tsx`), /open && activePanel !== "data"/);
  assert.doesNotMatch(styles, /position:\s*fixed|translate\(-50%|backdrop-filter/);
  assert.match(styles, /overflow-y: auto; overflow-x: hidden/);
  assert.match(styles, /__fixed \{ flex: 0 0 auto/);
});
test('Projects and map consume the exact same native scrollbar declaration block', () => {
  const shared = read('src/shared-sidebar-scrollbars.css');
  assert.match(read('src/pages/Projects/projects-scrollbars.css'), /@import "\.\.\/\.\.\/shared-sidebar-scrollbars\.css"/);
  assert.match(styles, /@import "\.\.\/\.\.\/\.\.\/\.\.\/shared-sidebar-scrollbars\.css"/);
  const css = postcss.parse(shared);
  for (const mode of ['(forced-colors: none)', '(forced-colors: active)']) {
    const media = css.nodes.find(node => node.type === 'atrule' && node.params === mode);
    for (const rule of media.nodes.filter(node => node.type === 'rule')) {
      assert.match(rule.selector, /\.maono-sidebar-scroll/);
      assert.match(rule.selector, /\.mm-sidebar-nav/);
    }
  }
  assert.match(shared, /width: 5px/);
  assert.match(shared, /border-radius: 99px/);
  assert.match(shared, /scrollbar-color: var\(--mm-border-strong\) transparent/);
  assert.match(shared, /scrollbar-color: auto/);
});

test('native Parquet uses its existing ESM implementation so browser WASM initialization is retained', () => {
  const config = read('vite.config.ts');
  assert.match(config, /node_modules\/@loaders\.gl\/parquet\/dist\/index\.js/);
  assert.match(config, /find: \/\^@loaders/);
  assert.match(config, /node_modules\/apache-arrow\/Arrow\.dom\.mjs/);
  assert.doesNotMatch(sources, /parquet-wasm|initializeParquet|parseParquet/);
});
test('import session cannot cross context revisions and does not disable the legacy shell', () => {
  assert.match(runtime, /if \(!customMapShellEnabled \|\| !context\) return;/);
  assert.match(runtime, /context\?\.organization\?\.id, context\?\.project\?\.slug, context\?\.version, context\?\.mode/);
  assert.match(runtime, /dataSessionKey\.current !== dataContextKey/);
});
