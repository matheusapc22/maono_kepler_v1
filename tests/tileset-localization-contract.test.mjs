import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

// These presentation copies were reviewed against Kepler 3.2.0. A mismatch is
// an upgrade/review gate: compare the new native behavior and localization
// intentionally, rather than automatically updating snapshots or bypassing it.
const REVIEW_REQUIREMENT =
  "Tileset presentation was reviewed against @kepler.gl/components 3.2.0. " +
  "Review dependency changes, native processing and localized presentation before updating this contract.";
const require = createRequire(import.meta.url);
const localDirectory = new URL(
  "../src/pages/Kepler/components/load-data-modal/tilesets/",
  import.meta.url,
);
const readLocal = (name) => readFile(new URL(name, localDirectory), "utf8");

async function readNativeSource(name) {
  const nativePath = require.resolve(
    `@kepler.gl/components/dist/modals/tilesets-modals/${name}.js`,
  );
  const compiled = await readFile(nativePath, "utf8");
  const match = compiled.match(
    /\/\/# sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([^\s]+)/,
  );
  assert.ok(match, `${name}: native inline source map missing. ${REVIEW_REQUIREMENT}`);
  const sourceMap = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
  const index = sourceMap.sources.findIndex((source) =>
    source.endsWith(`/${name}.tsx`) || source === `${name}.tsx`,
  );
  assert.ok(index >= 0, `${name}: original TSX missing. ${REVIEW_REQUIREMENT}`);
  const source = sourceMap.sourcesContent[index];
  assert.equal(typeof source, "string", `${name}: TSX content missing. ${REVIEW_REQUIREMENT}`);
  return source;
}

function coreBeforeReturnedJSX(source, componentName) {
  const signature = new RegExp(
    `const ${componentName}: React\\.FC<[^>]+> = \\(\\{setResponse\\}\\) => \\{`,
  );
  const match = signature.exec(source);
  assert.ok(match, `${componentName}: signature changed. ${REVIEW_REQUIREMENT}`);
  const start = match.index + match[0].length;
  const end = source.indexOf("  return (\n    <TilesetInputContainer>", start);
  assert.ok(end > start, `${componentName}: form boundary changed. ${REVIEW_REQUIREMENT}`);
  // Intentionally exact: preserve state, requests, hooks, validation, callbacks
  // and native dataset payload construction before localized JSX is returned.
  return source.slice(start, end);
}

function importsFrom(source, moduleName) {
  const file = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return file.statements
    .filter((statement) => ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === moduleName)
    .map((statement) => statement.importClause?.getText(file));
}

function variableDeclaration(source, name) {
  const file = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const statement of file.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const declaration = statement.declarationList.declarations.find((item) => item.name.getText(file) === name);
    if (declaration) return declaration.getText(file);
  }
  assert.fail(`${name}: declaration missing. ${REVIEW_REQUIREMENT}`);
}

const forms = [
  ["tileset-vector-form", "TilesetVectorForm"],
  ["tileset-raster-form", "RasterTileForm"],
  ["tileset-wms-form", "TilesetWMSForm"],
];
const sources = new Map(
  await Promise.all(
    forms.map(async ([name]) => [
      name,
      {native: await readNativeSource(name), local: await readLocal(`${name}.tsx`)},
    ]),
  ),
);

test("Kepler version changes require an explicit review of the 3.2.0 presentation copies", async () => {
  const packageJson = JSON.parse(await readFile(require.resolve("@kepler.gl/components/package.json"), "utf8"));
  assert.equal(packageJson.version, "3.2.0", REVIEW_REQUIREMENT);
});

for (const [name, componentName] of forms) {
  test(`${name} preserves the exact native core body before returned JSX`, () => {
    const {native, local} = sources.get(name);
    assert.equal(
      coreBeforeReturnedJSX(local, componentName),
      coreBeforeReturnedJSX(native, componentName),
      `${name}: native core behavior changed. ${REVIEW_REQUIREMENT}`,
    );
  });
}

test("vector and raster datasets use the installed native builders without local copies", () => {
  for (const [name, builder] of [
    ["tileset-vector-form", "getDatasetAttributesFromVectorTile"],
    ["tileset-raster-form", "getDatasetAttributesFromRasterTile"],
  ]) {
    const {native, local} = sources.get(name);
    assert.match(native, new RegExp(`export function ${builder}\\(`), REVIEW_REQUIREMENT);
    assert.deepEqual(
      importsFrom(local, `@kepler.gl/components/dist/modals/tilesets-modals/${name}`),
      [`{${builder}}`],
      REVIEW_REQUIREMENT,
    );
    assert.doesNotMatch(local, new RegExp(`(?:function|const|let)\\s+${builder}\\b`));
  }
});

test("vector and raster metadata fetching still uses the exact native hook imports", () => {
  for (const [name, hook] of [
    ["tileset-vector-form", "use-fetch-vector-tile-metadata"],
    ["tileset-raster-form", "use-fetch-raster-tile-metadata"],
  ]) {
    const {native, local} = sources.get(name);
    assert.deepEqual(
      importsFrom(local, `@kepler.gl/components/dist/hooks/${hook}`),
      importsFrom(native, `../../hooks/${hook}`),
      REVIEW_REQUIREMENT,
    );
  }
});

test("raster collection and PMTiles metadata processing helper is unchanged", () => {
  const {native, local} = sources.get("tileset-raster-form");
  assert.equal(
    variableDeclaration(local, "parseMetadataAllowCollections"),
    variableDeclaration(native, "parseMetadataAllowCollections"),
    REVIEW_REQUIREMENT,
  );
});

// Transpile this dependency-free presentation helper only. No app import,
// browser, bundling, network access or build is needed: node --test works.
const localizerSource = await readLocal("localize-tileset-error.ts");
const {outputText} = ts.transpileModule(localizerSource, {
  compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
});
const {localizeTilesetError} = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);

for (const [description, input, expected] of [
  ["null errors stay absent", null, null],
  ["empty errors stay absent", "", null],
  [
    "MVT guidance uses the Portuguese vector form label",
    "For .pmtiles in mvt format, please use the Vector Tile form.",
    "Para arquivos .pmtiles no formato MVT, use o formulário Vetorial.",
  ],
  [
    "raster guidance uses the Portuguese matricial form label",
    "For .pmtiles in raster format, please use the Raster Tile form.",
    "Para arquivos .pmtiles no formato matricial, use o formulário Matricial.",
  ],
  [
    "HTTP failure retains its exact status code",
    "Metadata loading failed: 404 Not Found",
    "Não foi possível carregar os metadados (HTTP 404).",
  ],
  [
    "remote URLs remain verbatim",
    "Failed Fetch https://example.test/EnglishName/STAC.json",
    "Não foi possível carregar os metadados de https://example.test/EnglishName/STAC.json",
  ],
  [
    "STAC validation retains technical metadata keys",
    "At least one STAC asset must have both eo:bands and raster:bands data.",
    "Pelo menos um recurso STAC deve conter dados de eo:bands e raster:bands.",
  ],
  [
    "JSON errors receive a Portuguese explanation",
    "Unexpected end of JSON input",
    "Os metadados recebidos não contêm JSON válido.",
  ],
  [
    "unknown remote errors receive the localized fallback",
    "Unrecognized parser error",
    "Não foi possível carregar os metadados. Verifique a URL, o formato e as permissões de acesso.",
  ],
]) {
  test(`error presentation: ${description}`, () => {
    assert.equal(localizeTilesetError(input), expected);
  });
}
