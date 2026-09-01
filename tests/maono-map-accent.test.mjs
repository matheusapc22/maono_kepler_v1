import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const ROOT = new URL("../", import.meta.url);

const [
  globalTokens,
  mapTokens,
  themeBridge,
  accentLayer,
  mapShell,
  pointCluster,
  mapGate,
  packageJson,
] = await Promise.all([
  readFile(new URL("src/maono-design-tokens.css", ROOT), "utf8"),
  readFile(
    new URL(
      "src/pages/Kepler/components/maono-map-shell/maono-map-tokens.css",
      ROOT,
    ),
    "utf8",
  ),
  readFile(new URL("src/pages/Kepler/maono-kepler-theme.ts", ROOT), "utf8"),
  readFile(
    new URL(
      "src/pages/Kepler/components/maono-map-shell/maono-map-accent.css",
      ROOT,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "src/pages/Kepler/components/maono-map-shell/MaonoMapShell.tsx",
      ROOT,
    ),
    "utf8",
  ),
  readFile(
    new URL("src/pages/Kepler/components/point-cluster-settings-panel.css", ROOT),
    "utf8",
  ),
  readFile(new URL("src/pages/Kepler/map-panel/map-panel.css", ROOT), "utf8"),
  readFile(new URL("package.json", ROOT), "utf8"),
]);

function cssToken(source, name) {
  const match = source.match(new RegExp(`${name}\\s*:\\s*([^;]+);`, "i"));
  assert.ok(match, `token ausente: ${name}`);
  return match[1].trim().toLowerCase();
}

function tsStringConstant(source, name) {
  const match = source.match(
    new RegExp(`export const ${name}\\s*=\\s*["']([^"']+)["']`, "i"),
  );
  assert.ok(match, `constante ausente: ${name}`);
  return match[1].trim().toLowerCase();
}

test("shell do mapa deriva marca e semântica dos tokens globais", () => {
  assert.match(mapTokens, /--maono-map-gold:\s*var\(--maono-accent,/);
  assert.match(
    mapTokens,
    /--maono-map-gold-bright:\s*var\(--maono-accent-bright,/,
  );
  assert.match(
    mapTokens,
    /--maono-map-success:\s*var\(--maono-semantic-success,/,
  );
  assert.match(
    mapTokens,
    /--maono-map-warning:\s*var\(--maono-semantic-warning,/,
  );
  assert.match(mapTokens, /--maono-map-info:\s*var\(--maono-semantic-info,/);
});

test("tema Kepler espelha os tokens oficiais e elimina defaults verdes/cyan ativos", () => {
  assert.equal(
    tsStringConstant(themeBridge, "MAONO_KEPLER_ACCENT"),
    cssToken(globalTokens, "--maono-accent"),
  );
  assert.equal(
    tsStringConstant(themeBridge, "MAONO_KEPLER_ACCENT_BRIGHT"),
    cssToken(globalTokens, "--maono-accent-bright"),
  );
  assert.equal(
    tsStringConstant(themeBridge, "MAONO_KEPLER_ACCENT_TEXT"),
    cssToken(globalTokens, "--maono-accent-text"),
  );

  for (const key of [
    "activeColor",
    "activeColorHover",
    "primaryBtnBgd",
    "primaryBtnActBgd",
    "primaryBtnBgdHover",
    "ctaBtnBgd",
    "ctaBtnActBgd",
    "selectionBtnActColor",
    "selectionBtnBorderActColor",
    "switchTrackBgdActive",
    "checkboxBoxBgdChecked",
    "histogramFillInRange",
  ]) {
    assert.match(themeBridge, new RegExp(`${key}:\\s*MAONO_KEPLER_ACCENT`));
  }

  assert.match(
    themeBridge,
    /Object\.assign\(keplerTheme, MAONO_KEPLER_THEME_OVERRIDES\)/,
  );

  for (const legacy of ["#0f9668", "#13b17b", "#1fbad6", "#108188"]) {
    assert.ok(
      !themeBridge.toLowerCase().includes(legacy),
      `accent nativo legado reintroduzido no bridge: ${legacy}`,
    );
  }
});

test("bridge de tema e camada visual carregam no shell sem tocar no viewport", () => {
  const themeImport = 'import "../../maono-kepler-theme";';
  const tokenImport = 'import "./maono-map-tokens.css";';
  const layoutImport = 'import "./maono-map-layout-contract.css";';
  const accentImport = 'import "./maono-map-accent.css";';

  for (const entry of [themeImport, tokenImport, layoutImport, accentImport]) {
    assert.ok(mapShell.includes(entry), `import ausente: ${entry}`);
  }

  assert.ok(mapShell.indexOf(themeImport) < mapShell.indexOf(tokenImport));
  assert.ok(mapShell.indexOf(layoutImport) < mapShell.indexOf(accentImport));

  const accentLayerCode = accentLayer.replace(/\/\*[\s\S]*?\*\//g, "");

  assert.doesNotMatch(accentLayerCode, /\.maono-map-runtime__map\s*\{/);
  assert.doesNotMatch(accentLayerCode, /ResizeObserver/);
});

test("tabs, filtros, basemap e ferramentas usam o contrato dourado", () => {
  assert.match(accentLayer, /\.maono-layer-panel__tabs button\.is-active/);
  assert.match(accentLayer, /--maono-accent-bright/);
  assert.match(accentLayer, /\.maono-filter-group\.is-expanded/);
  assert.match(accentLayer, /\.maono-filter-focus-results/);
  assert.match(accentLayer, /\.maono-basemap-panel__option\.is-selected/);
  assert.match(accentLayer, /\.maono-map-overlay__buttons > button\.is-active/);
  assert.match(accentLayer, /\.maono-geometry-runtime-controls > button\.is-active/);
  assert.match(accentLayer, /--maono-focus-ring/);
});

test("states funcionais do mapa continuam semânticos", () => {
  assert.match(
    accentLayer,
    /\.maono-map-topbar__status\.is-clean\s*\{[\s\S]*?--maono-semantic-success/,
  );
  assert.match(
    accentLayer,
    /\.maono-map-topbar__status\.is-dirty\s*\{[\s\S]*?--maono-semantic-warning/,
  );
  assert.match(
    accentLayer,
    /\.maono-map-topbar__status\.is-loading\s*\{[\s\S]*?--maono-semantic-info/,
  );
  assert.doesNotMatch(
    accentLayer,
    /\.maono-layer-panel__notice\.is-error[\s\S]*?--maono-accent/,
  );
});

test("painel de agrupamento de pontos deixa de usar branding verde", () => {
  const normalized = pointCluster.toLowerCase();

  for (const legacy of ["#20c7b5", "#163b37", "#102825", "#081c1a"]) {
    assert.ok(!normalized.includes(legacy), `verde legado encontrado: ${legacy}`);
  }

  assert.match(pointCluster, /accent-color:\s*var\(--maono-accent\)/);
  assert.match(pointCluster, /--maono-accent-border/);
  assert.match(pointCluster, /--maono-accent-glow/);
  assert.match(pointCluster, /--maono-focus-ring/);
  assert.match(pointCluster, /--maono-semantic-warning/);
});

test("gate de acesso do mapa usa CTA dourado e focus ring global", () => {
  assert.doesNotMatch(mapGate.toLowerCase(), /#2f7df4/);
  assert.match(mapGate, /--maono-accent-bright/);
  assert.match(mapGate, /--maono-accent-strong/);
  assert.match(mapGate, /--maono-focus-ring/);
});

test("teste de accent do mapa participa do gate test:map-panels", () => {
  const pkg = JSON.parse(packageJson);
  assert.match(pkg.scripts["test:map-panels"], /maono-map-accent\.test\.mjs/);
});