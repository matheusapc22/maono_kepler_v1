import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {build} from 'esbuild';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
// Runtime export names from product e47deac, before the React module extraction.
// Source consumers use the real .ts public entry: esbuild's default resolver
// selects .tsx first, unlike TypeScript. No resolver alias is installed here.
const publicModules = {
  'src/auth/session.ts': ['SessionProvider', 'useSession'],
  'src/components/access/OrganizationPermissionManager.ts': ['loadAccessGovernance', 'default'],
  'src/components/loading/LoadingProvider.ts': ['LoadingProvider', 'useLoading'],
  'src/pages/Kepler/clustering/point-cluster-controller-bridge.ts': ['PointClusterControllerBridge', 'usePointClusterController'],
  'src/pages/Kepler/engine-adapter/KeplerEngineAdapterProvider.ts': ['KeplerEngineAdapterProvider', 'useKeplerEngineAdapter'],
  'src/pages/Kepler/factories/layer-configurator.ts': ['CustomLayerConfiguratorFactory', 'replaceLayerConfigurator'],
  'src/pages/Kepler/factories/maono-legend-row.ts': ['parseKeplerLegendNumber', 'formatMaonoLegendNumber', 'formatMaonoLegendLabel', 'MaonoLegendRowFactory', 'replaceLegendRow'],
  'src/pages/Kepler/factories/maono-map-legend-panel.ts': ['MaonoMapLegendPanelFactory', 'replaceMapLegendPanel'],
  'src/pages/Kepler/factories/maono-map-popover.ts': ['MaonoMapPopoverFactory', 'replaceMapPopover'],
  'src/pages/Kepler/factories/map-control.ts': ['replaceMapControl'],
  'src/pages/Kepler/factories/panel-header.ts': ['CustomPanelHeaderFactory', 'replacePanelHeader'],
  'src/pages/Kepler/factories/side-panel.ts': ['CustomSidePanelFactory', 'replaceSidePanel'],
  'src/pages/Kepler/map-panel/MapPanelContext.ts': ['MapPanelContextProvider', 'useMapPanel', 'useOptionalMapPanel', 'useMapPanelCapability'],
  'src/pages/Projects.ts': ['mergeProjectSnapshot', 'default'],
};
const targets = new Map(Object.keys(publicModules).map(file => [path.resolve(root, file.slice(0, -3)), file]));

function ambiguousImports(file, source) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const findings = [];
  function visit(node) {
    let specifier;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
    else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) specifier = node.arguments[0];
    if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) {
      const stem = specifier.text.replace(/\.tsx?$/, '');
      const target = targets.get(path.resolve(root, path.dirname(file), stem));
      // The public entry alone imports its own component implementation.
      const ownImplementation = file === target && specifier.text === stem + '.tsx';
      if (target && !ownImplementation && specifier.text !== stem + '.ts') {
        findings.push(`${file}:${parsed.getLineAndCharacterOfPosition(specifier.getStart()).line + 1}: ${specifier.text}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return findings;
}

function sourceFiles(directory) {
  return readdirSync(path.resolve(root, directory), {withFileTypes: true}).flatMap(entry => {
    const file = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(file) : /\.(?:[cm]?js|tsx?)$/.test(file) ? [file] : [];
  });
}

test('all source, fixtures and harness consumers select the public entry explicitly', () => {
  const findings = ['src', 'tests', 'scripts'].flatMap(sourceFiles).flatMap(file =>
    ambiguousImports(file, readFileSync(path.resolve(root, file), 'utf8')));
  assert.deepEqual(findings, []);
});

test('the import guard detects the historical loading failure and dynamic entry drift', () => {
  assert.equal(ambiguousImports('src/components/loading/useLoadingActivity.ts',
    'import {useLoading} from "./LoadingProvider";').length, 1);
  assert.equal(ambiguousImports('src/components/loading/useLoadingActivity.ts',
    'import {useLoading} from "./LoadingProvider.tsx";').length, 1);
  assert.equal(ambiguousImports('src/route-modules.ts',
    'const projects = () => import("./pages/Projects");').length, 1);
  assert.deepEqual(ambiguousImports('src/components/loading/LoadingProvider.ts',
    'export {LoadingProvider} from "./LoadingProvider.tsx";'), []);
});

test('all fourteen real public entries retain their product runtime exports', async () => {
  const result = await build({
    absWorkingDir: root, entryPoints: Object.keys(publicModules), outdir: 'test-results/lint-entrypoints',
    bundle: true, packages: 'external', write: false, metafile: true, format: 'esm', platform: 'browser',
    jsx: 'automatic', define: {'import.meta.env': '{}'}, logLevel: 'silent',
    loader: {'.css': 'empty', '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.svg': 'dataurl'},
  });
  for (const [file, expected] of Object.entries(publicModules)) {
    const output = Object.values(result.metafile.outputs).find(item => item.entryPoint === file);
    assert.ok(output, `compiled public entry ${file}`);
    for (const name of expected) assert.ok(output.exports.includes(name), `${file} still exports ${name}`);
  }
});

test('the actual preview-pipeline fixture bundles with default esbuild resolution', async () => {
  const result = await build({
    absWorkingDir: root, entryPoints: ['tests/browser/fixtures/project-preview-pipeline.tsx'],
    bundle: true, write: false, metafile: true, format: 'iife', globalName: 'previewFixture',
    platform: 'browser', jsx: 'automatic', loader: {'.css': 'empty', '.png': 'dataurl'}, logLevel: 'silent',
    define: {'import.meta.env': JSON.stringify({DEV: false, PROD: false, VITE_PROJECT_PREVIEW_TRANSITION_V2: 'true'})},
    // Same preloading boundary as the browser spec; no provider/hook replacement.
    plugins: [{name: 'navigation-boundary', setup(plugin) {
      plugin.onResolve({filter: /route-modules$/}, () => ({path: 'route-modules', namespace: 'fixture'}));
      plugin.onLoad({filter: /.*/, namespace: 'fixture'}, () => ({contents: 'export const preloadRouteModule = async () => undefined;', loader: 'js'}));
    }}],
  });
  assert.ok(result.metafile.inputs['src/components/loading/LoadingProvider.ts']);
  assert.ok(result.metafile.inputs['src/components/loading/LoadingProvider.tsx']);
  assert.ok(result.metafile.inputs['src/components/loading/loading-context.ts']);
  assert.ok(result.outputFiles[0].text.length > 0);
});
