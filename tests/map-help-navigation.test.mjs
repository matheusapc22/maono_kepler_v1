import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const version = JSON.parse(await readFile(require.resolve('@kepler.gl/components/package.json'), 'utf8')).version;
async function nativeSource(path) {
  const compiled = await readFile(require.resolve(`@kepler.gl/components/dist/${path}.js`), 'utf8');
  const match = compiled.match(/\/\/# sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([^\s]+)/);
  assert.ok(match, 'Review the native component contract after a dependency upgrade');
  return JSON.parse(Buffer.from(match[1], 'base64')).sourcesContent[0];
}
const compile = source => ts.transpileModule(source, {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React, removeComments: true},
}).outputText;

test('help adapters are explicitly reviewed against Kepler 3.2.0', () => assert.equal(version, '3.2.0'));

test('every package directly imported by the help adapters is declared and resolvable', async () => {
  const manifest = JSON.parse(await read('package.json'));
  const files = ['components/export-map-modal/export-html-map.tsx', 'components/export-map-modal/export-json-map.tsx',
    'factories/export-map-help.ts', 'factories/file-upload.tsx'];
  for (const file of files) {
    const source = await read(`src/pages/Kepler/${file}`);
    for (const [, specifier] of source.matchAll(/from ['"]([^'"]+)['"]/g)) {
      if (specifier.startsWith('.')) continue;
      const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      assert.ok(manifest.dependencies[packageName], `${file} directly imports undeclared ${packageName}`);
      assert.ok(require.resolve(specifier), `${specifier} must resolve in npm and clean Yarn installs`);
    }
  }
  assert.equal(manifest.dependencies['react-copy-to-clipboard'], '^5.0.2');
  assert.equal(manifest.dependencies['@kepler.gl/localization'], '3.2.0');
  const lock = await read('yarn.lock');
  assert.match(lock, /react-copy-to-clipboard@(?:npm:)?\^5\.0\.2"?:\n  version:? "?5\.1\.0"?/);
  assert.equal(JSON.parse(await readFile(require.resolve('react-copy-to-clipboard/package.json'), 'utf8')).version, '5.1.0');
});

for (const name of ['export-html-map', 'export-json-map']) {
  test(`${name} preserves the full native render and behavior except docs anchors`, async () => {
    let native = (await nativeSource(`modals/export-map-modal/${name}`))
      .replaceAll("'../../common/styled-components'", "'@kepler.gl/components/dist/common/styled-components'")
      .replaceAll("'./components'", "'@kepler.gl/components/dist/modals/export-map-modal/components'")
      .replace(/<(?:ExportMapLink|a) href=\{(?:EXPORT_HTML_MAP_DOC|EXPORT_HTML_MAP_MODES_DOC|ADD_DATA_TO_MAP_DOC)\}>/g, '<span>')
      .replace(/<\/(?:ExportMapLink|a)>/g, '</span>');
    if (name === 'export-html-map') {
      native = native
        .replace("            <FormattedMessage id={'modal.exportMap.html.tokenDisclaimer'} />\n            <span>\n              <FormattedMessage id={'modal.exportMap.html.tokenUpdate'} />\n            </span>\n", '')
        .replace('          <div className="subtitle">\n' + "            <FormattedMessage id={'modal.exportMap.html.modeSubtitle1'} />\n            <span>\n              <FormattedMessage id={'modal.exportMap.html.modeSubtitle2'} />\n            </span>\n          </div>\n", '');
    }
    const local = await read(`src/pages/Kepler/components/export-map-modal/${name}.tsx`);
    assert.equal(compile(local), compile(native));
    assert.doesNotMatch(local, /href=|<a\b|ExportMapLink/);
  });
}

test('file upload guidance adapter retains native class behavior and limits its renderer scope', async () => {
  const native = await nativeSource('common/file-uploader/file-upload');
  assert.match(native, /class FileUpload extends Component/);
  assert.match(native, /static getDerivedStateFromProps\(/);
  assert.match(native, /return injectIntl\(FileUpload\)/);
  assert.match(native, /className="file-upload__message"/);
  assert.match(native, /component: LinkRenderer/);
  const local = await read('src/pages/Kepler/factories/file-upload.tsx');
  assert.match(local, /extends NativeFileUpload/);
  assert.match(local, /adaptFormatGuidance\(super\.render\(\)\)/);
  assert.match(local, /child\.props\.className === 'file-upload__message'/);
  assert.match(local, /isGuidance && typeof child\.props\.children === 'string' && child\.props\.options\?\.overrides\?\.a/);
  assert.match(local, /if \(!isValidElement\(node\) && !Array\.isArray\(node\)\) return node;/);
  assert.match(local, /hostname === 'docs\.kepler\.gl'/);
  assert.match(local, /<span>\{props\.children\}<\/span> : <LinkRenderer \{\.\.\.props\} \/>/);
  assert.doesNotMatch(local, /_handleFileInput|_isValidFileType|_toggleDragState|setState|onFileUpload\(/);
});

test('all help-free factories are wired into the application and both tileset entry points', async () => {
  const app = await read('src/pages/Kepler/index.tsx');
  for (const name of ['replaceFileUpload', 'replaceExportHtmlMap', 'replaceExportJsonMap']) assert.match(app, new RegExp(`${name}\\(\\)`));
  const load = await read('src/pages/Kepler/factories/load-data-modal.ts');
  assert.match(load, /id: "tileset", label: "modal.loadData.tileset", elementType: LocalizedLoadTilesetTab/);
  assert.match(load, /if \(source === "tileset"\) return React.createElement\(LocalizedLoadTilesetTab/);
  assert.ok(app.indexOf('  replacePanelHeader(),') > app.indexOf('  replaceSidePanel(),'));
  const header = await read('src/pages/Kepler/factories/panel-header.tsx');
  assert.doesNotMatch(header, /BUG_REPORT_LINK|USER_GUIDE_DOC|id: "(?:bug|docs)"/);
  assert.match(header, /context\?\.capabilities\?\.saveMap/);
  for (const name of ['storage', 'save']) assert.match(header, new RegExp(`item.id === "${name}"`));
  const raster = await read('src/pages/Kepler/components/load-data-modal/tilesets/tileset-raster-form.tsx');
  assert.doesNotMatch(raster, /InfoIconLink|RASTER_TILE_DOCUMENTATION_URL|<Help|href=/);
  assert.match(raster, /htmlFor="tileset-raster-servers"/);
  assert.match(raster, /onChange=\{onRasterTileServerUrlsChange\}/);
});
