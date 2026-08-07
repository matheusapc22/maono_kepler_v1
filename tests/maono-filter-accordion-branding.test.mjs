import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  filterPanel:
    "../src/pages/Kepler/components/maono-layer-panel/FilterPanel.tsx",
  filterStyles:
    "../src/pages/Kepler/components/maono-layer-panel/filters/advanced-filters.css",
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
