import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { authorizeMapPanelCommand } from "../src/pages/Kepler/map-panel/map-panel-capabilities.ts";
import {
  normalizeKeplerDatasets,
  normalizeKeplerFilters,
  normalizeKeplerLayers,
} from "../src/pages/Kepler/integration/keplerBridge.ts";

const files = {
  routes: "../src/Routes.tsx",
  provider: "../src/pages/Kepler/map-panel/MapPanelProvider.tsx",
  loader: "../src/pages/Kepler/map-url-loader/index.tsx",
  controller: "../src/pages/Kepler/hooks/useKeplerController.ts",
  engineCommands: "../src/pages/Kepler/engine-adapter/commands.ts",
  engineProvider:
    "../src/pages/Kepler/engine-adapter/KeplerEngineAdapterProvider.tsx",
  bridge: "../src/pages/Kepler/integration/keplerBridge.ts",
  capabilities: "../src/pages/Kepler/map-panel/map-panel-capabilities.ts",
  telemetry: "../src/pages/Kepler/map-panel/map-panel-telemetry.ts",
  panel: "../src/pages/Kepler/components/maono-layer-panel/MaonoLayerPanel.tsx",
  layerList: "../src/pages/Kepler/components/maono-layer-panel/LayerList.tsx",
  layerListItem:
    "../src/pages/Kepler/components/maono-layer-panel/LayerListItem.tsx",
  addLayerMenu:
    "../src/pages/Kepler/components/maono-layer-panel/AddLayerMenu.tsx",
  inspector:
    "../src/pages/Kepler/components/maono-layer-panel/LayerInspector.tsx",
  styleEditor:
    "../src/pages/Kepler/components/maono-layer-panel/LayerStyleEditor.tsx",
  palettes:
    "../src/pages/Kepler/components/maono-layer-panel/palettes.ts",
  filters: "../src/pages/Kepler/components/maono-layer-panel/FilterPanel.tsx",
  filterValue:
    "../src/pages/Kepler/components/maono-layer-panel/filters/FilterValueEditor.tsx",
  filterHistogram:
    "../src/pages/Kepler/components/maono-layer-panel/filters/FilterHistogram.tsx",
  filterUtils:
    "../src/pages/Kepler/components/maono-layer-panel/filters/filter-utils.ts",
  filterStyles:
    "../src/pages/Kepler/components/maono-layer-panel/filters/advanced-filters.css",
  errorBoundary:
    "../src/pages/Kepler/components/maono-layer-panel/ErrorBoundary.tsx",
  sidePanel: "../src/pages/Kepler/factories/side-panel.tsx",
  configurator: "../src/pages/Kepler/factories/layer-configurator.tsx",
  header: "../src/pages/Kepler/factories/panel-header.tsx",
  save: "../src/pages/Kepler/components/maono-save-button.tsx",
  index: "../src/pages/Kepler/index.tsx",
  projectCard: "../src/pages/Projects/components/ProjectCard.tsx",
};

const source = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([key, path]) => [
      key,
      await readFile(new URL(path, import.meta.url), "utf8"),
    ]),
  ),
);

test("rotas canônicas separam gerenciar, visualizar, editar e novo mapa", () => {
  assert.match(source.routes, /:projectSlug\/manage/);
  assert.match(source.routes, /:projectSlug\/view/);
  assert.match(source.routes, /:projectSlug\/edit/);
  assert.match(source.routes, /\/maps\/new\/create/);
  assert.match(source.routes, /LegacyProjectMapRedirect/);
  assert.match(source.projectCard, /:.*\/manage|\/manage/);
});

test("contexto é invalidado ao trocar a organização ativa", () => {
  assert.match(source.provider, /organizationKey/);
  assert.match(
    source.provider,
    /\[\s*isNewMap,[\s\S]*organizationKey,[\s\S]*projectSlug/,
  );
  assert.match(source.provider, /AbortController/);
  assert.match(source.provider, /map_context_invalidated/);
  assert.match(source.provider, /map_panel_opened/);
});

test("viewer carrega Kepler em readOnly e não recebe botão salvar", () => {
  assert.match(source.loader, /readOnly:\s*readOnly/);
  assert.match(source.loader, /context\?\.mode === "viewer"/);
  assert.match(source.save, /context\?\.capabilities\?\.saveMap/);
  assert.match(source.save, /if \(!allowed\)\s*\{\s*return null/);
  assert.match(source.save, /map_save_requested/);
  assert.match(source.save, /map_save_succeeded/);
  assert.match(source.save, /map_save_conflict/);
});

test("todo comando passa por uma capacidade do backend", () => {
  assert.match(
    source.engineCommands,
    /authorizeMapPanelCommand\([\s\S]*capabilities,[\s\S]*command,[\s\S]*capability/,
  );
  assert.match(source.capabilities, /capabilities\?\.\[capability\]/);
  assert.match(source.capabilities, /CAPABILITY_DENIED/);

  for (const capability of [
    "inspectLayer",
    "toggleLayerVisibility",
    "editLayerStyle",
    "createLayer",
    "removeLayer",
    "duplicateLayer",
    "reorderLayers",
    "editFilters",
  ]) {
    assert.match(source.engineCommands, new RegExp(`"${capability}"`));
  }

  assert.doesNotMatch(source.controller, /@kepler\.gl\/actions/);
  assert.match(source.controller, /useKeplerEngineAdapter/);
});

test("gate puro recusa mutação sem capability e aprova concessão explícita", () => {
  const denied = authorizeMapPanelCommand(
    undefined,
    "removeLayer",
    "removeLayer",
  );
  const allowed = authorizeMapPanelCommand(
    { removeLayer: true },
    "removeLayer",
    "removeLayer",
  );

  assert.deepEqual(denied, {
    ok: false,
    code: "CAPABILITY_DENIED",
    reason: "A capacidade removeLayer não foi concedida.",
    capability: "removeLayer",
    command: "removeLayer",
  });
  assert.deepEqual(allowed, { ok: true });
});

test("bridge normaliza coleções JS e Immutable sem mutar a origem", () => {
  const layer = {
    id: "layer-1",
    type: "point",
    config: {
      label: "Pontos",
      isVisible: true,
      color: [1, 2, 3],
      visConfig: { opacity: 0.5 },
    },
  };
  const layers = normalizeKeplerLayers({
    toArray: () => [layer],
  });
  const filters = normalizeKeplerFilters([
    { id: "filter-1", type: "range", value: [1, 2] },
  ]);
  const datasets = normalizeKeplerDatasets(
    new Map([["data-1", { label: "Dados" }]]),
  );

  assert.equal(layers[0].label, "Pontos");
  assert.equal(layers[0].opacity, 0.5);
  assert.deepEqual(filters[0].value, [1, 2]);
  assert.deepEqual(datasets, [
    {
      id: "data-1",
      label: "Dados",
      fields: [],
      rowCount: null,
      filteredRowCount: null,
      isVisible: false,
    },
  ]);
  assert.equal(layer.config.isVisible, true);
});

test("telemetria do controlador não inclui datasets ou coordenadas", () => {
  const telemetry = source.engineCommands.slice(
    source.engineCommands.indexOf("function telemetry"),
    source.engineCommands.indexOf("function run"),
  );

  assert.match(telemetry, /projectId/);
  assert.match(telemetry, /organizationId/);
  assert.doesNotMatch(telemetry, /datasets/);
  assert.doesNotMatch(telemetry, /coordinates/);
  assert.doesNotMatch(telemetry, /layer\.raw/);
  assert.match(source.engineCommands, /map_panel_command_denied/);
  assert.match(source.telemetry, /maono:map-panel-telemetry/);
});

test("painel oferece busca, visibilidade, inspeção, estilo e filtros", () => {
  assert.match(source.panel, /type="search"/);
  assert.match(source.panel, /toggleLayerVisibility/);
  assert.match(source.panel, /controller\.inspectLayer\(layer\.id\)/);
  assert.match(source.styleEditor, /type="range"/);
  assert.match(source.styleEditor, /type="color"/);
  assert.match(source.styleEditor, /MAONO_LAYER_PALETTES/);
  assert.match(source.inspector, /Modo de visualização/);
  assert.match(source.filters, /somente leitura/);
  assert.match(source.filters, /onRemove/);
  assert.match(source.filters, /onChangeValue/);
  assert.match(source.panel, /setFilterValue/);
});

test("filtros avançados cobrem tipos, domínio, histograma e troca de propriedade", () => {
  assert.match(source.filters, /onBindField/);
  assert.match(source.panel, /controller\.bindFilterField/);
  assert.match(source.panel, /controller\.setFilterValue/);
  assert.match(source.filterValue, /useDeferredValue/);
  assert.match(source.filterValue, /type="datetime-local"/);
  assert.match(source.filterValue, /type="range"/);
  assert.match(source.filterValue, /domainTruncated/);
  assert.match(source.filterValue, /FilterHistogram/);
  assert.match(source.filterUtils, /case "range"/);
  assert.match(source.filterUtils, /case "timeRange"/);
  assert.match(source.filterUtils, /case "multiSelect"/);
  assert.match(source.filterUtils, /case "select"/);
  assert.match(source.engineCommands, /validatedFilterValue/);
  assert.match(
    source.engineCommands,
    /setFilter\(index,\s*"dataId",\s*selected\.id,\s*0\)/,
  );
  assert.match(source.filters, /filteredRowCount/);
  assert.match(source.filterStyles, /\.maono-filter-histogram/);

  for (const key of [
    "filters",
    "filterValue",
    "filterHistogram",
    "filterUtils",
  ]) {
    assert.doesNotMatch(source[key], /@kepler\.gl\/actions/);
    assert.doesNotMatch(source[key], /checkAdminUser|user\?\.role/);
  }
});

test("estilos avançados cobrem formato, atributos, paletas e dimensões", () => {
  for (const format of ["point", "cluster", "heatmap"]) {
    assert.match(source.styleEditor, new RegExp(`"${format}"`));
  }

  for (const change of [
    "fillEnabled",
    "fillField",
    "fillScale",
    "fillPalette",
    "strokeEnabled",
    "strokeField",
    "strokeScale",
    "strokePalette",
    "strokeWidth",
    "pointRadius",
    "clusterRadius",
    "heatmapRadius",
  ]) {
    assert.match(source.styleEditor, new RegExp(`kind: "${change}"`));
  }

  for (const command of [
    "setLayerType",
    "setColorField",
    "setColorScale",
    "setColorPalette",
    "setStrokeColorField",
    "setStrokeColorScale",
    "setStrokeColorPalette",
    "setPointRadius",
    "setClusterOptions",
    "setHeatmapOptions",
  ]) {
    assert.match(source.panel, new RegExp(`controller\\.${command}`));
  }

  assert.match(source.engineCommands, /property[\s\S]*outline[\s\S]*stroked/);
  assert.match(source.engineCommands, /entre 2 e 20 cores/);
  assert.match(source.palettes, /Dourado Maõno/);
  assert.match(source.palettes, /#B7791F/);
  assert.match(source.palettes, /#FFF8E7/);
});

test("fase básica cobre criação, renomeação, duplicação, exclusão e ordenação", () => {
  assert.match(source.panel, /createLayerFromDataset/);
  assert.match(source.panel, /datasets=\{datasets\}/);
  assert.match(source.addLayerMenu, /role="menu"/);
  assert.match(source.addLayerMenu, /sortedDatasets\.map/);
  assert.match(source.addLayerMenu, /Importar novo dado/);

  assert.match(source.layerListItem, /maono-layer-list__rename/);
  assert.match(source.layerListItem, /draggable=\{canReorder && !editing\}/);
  assert.match(source.layerListItem, /Mover .* para cima/);
  assert.match(source.layerListItem, /Mover .* para baixo/);
  assert.match(source.layerListItem, /onDuplicate\(layer\)/);
  assert.match(source.layerListItem, /onRemove\(layer\)/);
  assert.match(source.layerList, /onReorder\(sourceLayerId, targetLayerId\)/);
  assert.match(source.panel, /window\.confirm/);
  assert.match(source.engineCommands, /uniqueLayerLabel/);
});

test("falhas aparecem no painel e viewer não recebe mutações proibidas", () => {
  assert.match(source.panel, /message:\s*result\.reason/);
  assert.match(source.panel, /role=\{notice\.kind === "error" \? "alert"/);
  assert.match(source.panel, /capabilities\?\.createLayer/);
  assert.match(source.panel, /capabilities\?\.duplicateLayer/);
  assert.match(source.panel, /capabilities\?\.removeLayer/);
  assert.match(source.panel, /capabilities\?\.reorderLayers/);
  assert.match(source.inspector, /Modo de visualização/);

  for (const key of [
    "panel",
    "layerList",
    "layerListItem",
    "addLayerMenu",
    "inspector",
    "styleEditor",
  ]) {
    assert.doesNotMatch(source[key], /@kepler\.gl\/actions/);
    assert.doesNotMatch(source[key], /checkAdminUser|user\?\.role/);
  }
});

test("integração preserva fallback nativo por feature flag", () => {
  assert.match(source.sidePanel, /customLayerPanelEnabled/);
  assert.match(
    source.sidePanel,
    /return <DefaultSidePanel \{\.\.\.props\} \/>/,
  );
  assert.match(
    source.sidePanel,
    /fallback=\{<DefaultSidePanel \{\.\.\.props\} \/>\}/,
  );
  assert.match(source.errorBoundary, /map_panel_fallback_used/);
  assert.match(source.provider, /VITE_MAONO_LAYER_MANAGER_V1/);
  assert.match(source.provider, /features\??\.mapPanelModes/);
});

test("factories e app não consultam roles brutas", () => {
  for (const key of ["sidePanel", "configurator", "header", "index"]) {
    assert.doesNotMatch(source[key], /checkAdminUser/);
    assert.doesNotMatch(source[key], /__MAONO_SESSION__/);
    assert.doesNotMatch(source[key], /user\?\.role/);
  }
});

test("Provider envolve Kepler antes das factories renderizarem", () => {
  assert.match(source.index, /<MapPanelProvider>/);
  assert.match(source.index, /<MapPanelAccessGate>/);
  assert.match(source.index, /<KeplerEngineAdapterProvider>/);
  assert.match(
    source.index,
    /<KeplerEngineAdapterProvider>[\s\S]*<ConnectedApp \/>/,
  );
  assert.match(source.engineProvider, /createKeplerEngineCommands/);
});
