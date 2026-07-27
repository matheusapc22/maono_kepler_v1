import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  authorizeMapPanelCommand,
} from "../src/pages/Kepler/map-panel/map-panel-capabilities.ts";
import {
  normalizeKeplerDatasets,
  normalizeKeplerFilters,
  normalizeKeplerLayers,
} from "../src/pages/Kepler/integration/keplerBridge.ts";

const files = {
  routes: "../src/Routes.tsx",
  provider: "../src/pages/Kepler/map-panel/MapPanelProvider.tsx",
  loader: "../src/pages/Kepler/map-url-loader/index.tsx",
  controller:
    "../src/pages/Kepler/hooks/useKeplerController.ts",
  bridge: "../src/pages/Kepler/integration/keplerBridge.ts",
  capabilities:
    "../src/pages/Kepler/map-panel/map-panel-capabilities.ts",
  telemetry:
    "../src/pages/Kepler/map-panel/map-panel-telemetry.ts",
  panel:
    "../src/pages/Kepler/components/maono-layer-panel/MaonoLayerPanel.tsx",
  inspector:
    "../src/pages/Kepler/components/maono-layer-panel/LayerInspector.tsx",
  filters:
    "../src/pages/Kepler/components/maono-layer-panel/FilterPanel.tsx",
  errorBoundary:
    "../src/pages/Kepler/components/maono-layer-panel/ErrorBoundary.tsx",
  sidePanel: "../src/pages/Kepler/factories/side-panel.tsx",
  configurator:
    "../src/pages/Kepler/factories/layer-configurator.tsx",
  header: "../src/pages/Kepler/factories/panel-header.tsx",
  save:
    "../src/pages/Kepler/components/maono-save-button.tsx",
  index: "../src/pages/Kepler/index.tsx",
  projectCard:
    "../src/pages/Projects/components/ProjectCard.tsx",
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
  assert.match(source.routes, /\/maps\/new\/edit/);
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
  assert.match(
    source.loader,
    /readOnly:\s*readOnly/,
  );
  assert.match(
    source.loader,
    /context\?\.mode === "viewer"/,
  );
  assert.match(
    source.save,
    /context\?\.capabilities\?\.saveMap/,
  );
  assert.match(source.save, /if \(!allowed\)\s*\{\s*return null/);
  assert.match(source.save, /map_save_requested/);
  assert.match(source.save, /map_save_succeeded/);
  assert.match(source.save, /map_save_conflict/);
});

test("todo comando passa por uma capacidade do backend", () => {
  assert.match(
    source.controller,
    /authorizeMapPanelCommand\([\s\S]*capabilities,[\s\S]*command,[\s\S]*capability/,
  );
  assert.match(
    source.capabilities,
    /capabilities\?\.\[capability\]/,
  );
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
    assert.match(source.controller, new RegExp(`"${capability}"`));
  }
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
    { id: "data-1", label: "Dados", raw: { label: "Dados" } },
  ]);
  assert.equal(layer.config.isVisible, true);
});

test("telemetria do controlador não inclui datasets ou coordenadas", () => {
  const telemetry = source.controller.slice(
    source.controller.indexOf("function emitCommandTelemetry"),
    source.controller.indexOf(
      "export function useKeplerController",
    ),
  );

  assert.match(telemetry, /projectId/);
  assert.match(telemetry, /organizationId/);
  assert.doesNotMatch(telemetry, /datasets/);
  assert.doesNotMatch(telemetry, /coordinates/);
  assert.doesNotMatch(telemetry, /layer\.raw/);
  assert.match(source.controller, /map_panel_command_denied/);
  assert.match(source.telemetry, /maono:map-panel-telemetry/);
});

test("painel oferece busca, visibilidade, inspeção, estilo e filtros", () => {
  assert.match(source.panel, /type="search"/);
  assert.match(source.panel, /toggleLayerVisibility/);
  assert.match(source.inspector, /type="range"/);
  assert.match(source.inspector, /type="color"/);
  assert.match(source.inspector, /MAONO_LAYER_PALETTES/);
  assert.match(source.inspector, /Modo de visualização/);
  assert.match(source.filters, /somente leitura/);
  assert.match(source.filters, /onRemove/);
  assert.match(source.filters, /onChangeValue/);
  assert.match(source.panel, /setFilterValue/);
});

test("integração preserva fallback nativo por feature flag", () => {
  assert.match(
    source.sidePanel,
    /customLayerPanelEnabled/,
  );
  assert.match(
    source.sidePanel,
    /return <DefaultSidePanel \{\.\.\.props\} \/>/,
  );
  assert.match(
    source.sidePanel,
    /fallback=\{<DefaultSidePanel \{\.\.\.props\} \/>\}/,
  );
  assert.match(
    source.errorBoundary,
    /map_panel_fallback_used/,
  );
  assert.match(
    source.provider,
    /VITE_MAONO_LAYER_MANAGER_V1/,
  );
  assert.match(
    source.provider,
    /features\?\.mapPanelModes/,
  );
});

test("factories e app não consultam roles brutas", () => {
  for (const key of [
    "sidePanel",
    "configurator",
    "header",
    "index",
  ]) {
    assert.doesNotMatch(source[key], /checkAdminUser/);
    assert.doesNotMatch(source[key], /__MAONO_SESSION__/);
    assert.doesNotMatch(source[key], /user\?\.role/);
  }
});

test("Provider envolve Kepler antes das factories renderizarem", () => {
  assert.match(source.index, /<MapPanelProvider>/);
  assert.match(source.index, /<MapPanelAccessGate>/);
  assert.match(source.index, /<ConnectedApp \/>/);
});
