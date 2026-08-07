import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  filterPanel:
    "../src/pages/Kepler/components/maono-layer-panel/FilterPanel.tsx",
  filterValue:
    "../src/pages/Kepler/components/maono-layer-panel/filters/FilterValueEditor.tsx",
  filterUtils:
    "../src/pages/Kepler/components/maono-layer-panel/filters/filter-utils.ts",
  filterStyles:
    "../src/pages/Kepler/components/maono-layer-panel/filters/advanced-filters.css",
  layerPanel:
    "../src/pages/Kepler/components/maono-layer-panel/MaonoLayerPanel.tsx",
  selectors: "../src/pages/Kepler/engine-adapter/selectors.ts",
  localization: "../src/pages/Kepler/constants/localization.ts",
  announcement: "../src/pages/Kepler/components/announcement.tsx",
  cloudProviders: "../src/pages/Kepler/cloud-providers/index.ts",
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, path]) => [
      key,
      await readFile(new URL(path, import.meta.url), "utf8"),
    ]),
  ),
);

test("grupos de filtros usam camadas como identificação e começam recolhidos", () => {
  assert.match(source.filterPanel, /useKeplerState/);
  assert.match(source.filterPanel, /const \{ layers \} = useKeplerState\(\)/);
  assert.match(source.filterPanel, /label: layer\.label/);
  assert.match(source.filterPanel, /const \[expandedGroupKey, setExpandedGroupKey\] = useState<string \| null>\(null\)/);
  assert.match(source.filterPanel, /aria-expanded=\{expanded\}/);
  assert.match(source.filterPanel, /expanded \? \(/);
  assert.match(source.filterPanel, /chevron-up/);
  assert.match(source.filterPanel, /chevron-down/);
  assert.doesNotMatch(source.filterPanel, /filteredRowCount/);
});

test("accordion mantém somente um grupo aberto e fecha ao clicar novamente", () => {
  assert.match(
    source.filterPanel,
    /current === group\.key \? null : group\.key/,
  );
  assert.match(source.filterPanel, /setExpandedGroupKey\(group\.key\)/);
  assert.match(source.filterPanel, /Filtros da camada \$\{group\.label\}/);
  assert.match(source.filterStyles, /\.maono-filter-group__toggle/);
  assert.match(source.filterStyles, /\.maono-filter-group\.is-expanded/);
  assert.doesNotMatch(source.filterStyles, /\.maono-filter-group__heading/);
});

test("categorias exibem nomes completos e toda a lista sem liberação em lotes", () => {
  assert.doesNotMatch(source.filterValue, /visibleLimit|setVisibleLimit/);
  assert.doesNotMatch(source.filterValue, /Mostrar mais/);
  assert.doesNotMatch(source.filterValue, /matching\.slice/);
  assert.match(source.filterValue, /matching\.map/);
  assert.match(
    source.filterStyles,
    /\.maono-filter-category__options label\s*\{[^}]*grid-template-columns:\s*13px minmax\(0,\s*1fr\)/s,
  );
  assert.match(
    source.filterStyles,
    /\.maono-filter-category__options strong\s*\{[^}]*white-space:\s*normal/s,
  );
  assert.match(
    source.filterStyles,
    /\.maono-filter-category__options strong\s*\{[^}]*overflow-wrap:\s*anywhere/s,
  );
  assert.doesNotMatch(source.filterStyles, /\.maono-filter-category__more/);
  assert.doesNotMatch(source.selectors, /MAX_FILTER_DOMAIN_VALUES/);
  assert.match(source.selectors, /type === "multiSelect"[\s\S]*domain:\s*values[\s\S]*domainTruncated:\s*false/);
});

test("carregamento e mensagens de filtro não exibem a marca técnica Kepler", () => {
  assert.match(source.layerPanel, /Aguarde enquanto o Maõno prepara as camadas\./);
  assert.doesNotMatch(source.layerPanel, /Aguarde enquanto o Kepler prepara as camadas\./);
  assert.doesNotMatch(source.filterValue, /\bKepler\b/);
  assert.doesNotMatch(source.filterUtils, /\bKepler\b/);
  assert.doesNotMatch(source.selectors, /painel nativo do Kepler|O Kepler ainda/);
});

test("referências explícitas visíveis a Kepler.gl são substituídas sem alterar referências técnicas", () => {
  for (const key of ["localization", "announcement", "cloudProviders"]) {
    assert.doesNotMatch(source[key], /Kepler\.gl/);
  }

  assert.match(source.localization, /Maõno config json/);
  assert.match(source.announcement, /Maõno turns two years old/);
  assert.match(source.cloudProviders, /Maõno Demo App/);

  // Copyrights e imports técnicos continuam livres para manter a origem/licenças.
  assert.match(source.localization, /kepler\.gl project/);
});
