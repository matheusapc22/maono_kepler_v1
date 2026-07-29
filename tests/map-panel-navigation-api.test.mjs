import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildMapCapabilities,
  getMapPanelFeatures,
  MAP_PANEL_POLICY_VERSION,
  resolveMapPanelDecision,
} from "../functions/_lib/map-panel-service.js";

const urls = {
  service: new URL(
    "../functions/_lib/map-panel-service.js",
    import.meta.url,
  ),
  endpoint: new URL(
    "../functions/api/projects/[slug]/map-navigation.js",
    import.meta.url,
  ),
  newMap: new URL(
    "../functions/api/maps/new/context.js",
    import.meta.url,
  ),
  permissions: new URL(
    "../functions/_lib/permissions.js",
    import.meta.url,
  ),
  routes: new URL("../src/Routes.tsx", import.meta.url),
  provider: new URL(
    "../src/pages/Kepler/map-panel/MapPanelProvider.tsx",
    import.meta.url,
  ),
  api: new URL(
    "../src/pages/Kepler/map-panel/map-panel-api.ts",
    import.meta.url,
  ),
  creation: new URL(
    "../functions/api/projects/index.js",
    import.meta.url,
  ),
};

const [
  service,
  endpoint,
  newMap,
  permissions,
  routes,
  provider,
  api,
  creation,
] = await Promise.all(
  Object.values(urls).map((url) => readFile(url, "utf8")),
);

test("política versionada resolve gerenciar, visualizar e editar", () => {
  assert.equal(MAP_PANEL_POLICY_VERSION, 1);

  assert.deepEqual(
    resolveMapPanelDecision({
      requestedMode: "manage",
      viewerAllowed: true,
      editorAllowed: true,
    }),
    {
      requestedMode: "manage",
      resolvedMode: "viewer",
      defaultPanel: "viewer",
      availablePanels: {
        viewer: true,
        editor: true,
      },
      allowed: true,
      reason: null,
    },
  );

  assert.equal(
    resolveMapPanelDecision({
      requestedMode: "viewer",
      viewerAllowed: true,
      editorAllowed: true,
    }).resolvedMode,
    "viewer",
  );
  assert.equal(
    resolveMapPanelDecision({
      requestedMode: "editor",
      viewerAllowed: true,
      editorAllowed: true,
    }).resolvedMode,
    "editor",
  );
});

test("editor negado recebe fallback explícito para viewer", () => {
  const decision = resolveMapPanelDecision({
    requestedMode: "editor",
    viewerAllowed: true,
    editorAllowed: false,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "MAP_EDITOR_FORBIDDEN");
  assert.equal(decision.defaultPanel, "viewer");
  assert.deepEqual(decision.availablePanels, {
    viewer: true,
    editor: false,
  });
});

test("viewer negado usa o código público padronizado", () => {
  const decision = resolveMapPanelDecision({
    requestedMode: "viewer",
    viewerAllowed: false,
    editorAllowed: false,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "MAP_VIEW_FORBIDDEN");
});

test("capacidades do viewer não incluem mutações persistentes", () => {
  const capabilities = buildMapCapabilities({
    viewerAllowed: true,
    editorAllowed: false,
    editMetadataAllowed: false,
    updateThumbnailAllowed: false,
  });

  assert.equal(capabilities.viewMap, true);
  assert.equal(capabilities.inspectLayer, true);
  assert.equal(capabilities.toggleLayerVisibility, true);

  for (const capability of [
    "editLayers",
    "editStyle",
    "editLayerStyle",
    "createLayer",
    "removeLayer",
    "duplicateLayer",
    "reorderLayers",
    "manageFilters",
    "editFilters",
    "saveMap",
    "editProjectMetadata",
    "updateThumbnail",
  ]) {
    assert.equal(capabilities[capability], false, capability);
  }
});

test("editor recebe comandos de edição sem capacidades de criação", () => {
  const capabilities = buildMapCapabilities({
    viewerAllowed: true,
    editorAllowed: true,
    editMetadataAllowed: true,
    updateThumbnailAllowed: true,
  });

  for (const capability of [
    "viewMap",
    "editLayers",
    "editStyle",
    "saveMap",
    "editProjectMetadata",
    "updateThumbnail",
  ]) {
    assert.equal(capabilities[capability], true, capability);
  }

  for (const capability of [
    "openCreateWorkspace",
    "createProject",
    "initializeMap",
  ]) {
    assert.equal(capabilities[capability], false, capability);
  }
});

test("create recebe capacidades explícitas para o primeiro save", () => {
  const capabilities = buildMapCapabilities({
    viewerAllowed: true,
    editorAllowed: true,
    createAllowed: true,
  });

  assert.equal(capabilities.openCreateWorkspace, true);
  assert.equal(capabilities.createProject, true);
  assert.equal(capabilities.initializeMap, true);
  assert.equal(capabilities.saveMap, true);
});

test("feature flags têm rollback seguro e opt-in", () => {
  assert.deepEqual(getMapPanelFeatures({}), {
    mapManagementHome: false,
    mapPanelModes: false,
    projectMapEditPermission: false,
    projectQuotaReservation: false,
    mapCreateRoute: false,
    maonoLayerManager: false,
    maonoMapShell: false,
    maonoMapOverlay: false,
    maonoIsochrone: false,
  });
  assert.deepEqual(
    getMapPanelFeatures({
      MAP_MANAGEMENT_HOME_V1: "true",
      MAP_PANEL_MODES_V1: "1",
      PROJECT_MAP_EDIT_PERMISSION_V1: "on",
      PROJECT_QUOTA_RESERVATION_V1: "yes",
      MAP_CREATE_ROUTE_V1: "true",
      MAONO_LAYER_MANAGER_V1: "true",
      MAONO_MAP_SHELL_V1: "true",
      MAONO_MAP_OVERLAY_V1: "true",
      MAONO_ISOCHRONE_V1: "true",
      GEOAPIFY_API_KEY: "configured-in-secret-store",
    }),
    {
      mapManagementHome: true,
      mapPanelModes: true,
      projectMapEditPermission: true,
      projectQuotaReservation: true,
      mapCreateRoute: true,
      maonoLayerManager: true,
      maonoMapShell: true,
      maonoMapOverlay: true,
      maonoIsochrone: true,
    },
  );
});

test("modo desconhecido falha com código padronizado", () => {
  assert.throws(
    () =>
      resolveMapPanelDecision({
        requestedMode: "admin",
        viewerAllowed: true,
        editorAllowed: true,
      }),
    (error) =>
      error?.status === 400 &&
      error?.code === "MAP_MODE_INVALID",
  );
});

test("modo create não é aceito para projeto existente", () => {
  assert.throws(
    () =>
      resolveMapPanelDecision({
        requestedMode: "create",
        viewerAllowed: true,
        editorAllowed: true,
      }),
    (error) =>
      error?.status === 400 &&
      error?.code === "MAP_MODE_INVALID" &&
      !error?.details?.allowedModes?.includes("create"),
  );
});

test("editor exige view, map.edit e save resolvidos no backend", () => {
  assert.match(
    service,
    /viewerAllowed\s*&&\s*mapEditAllowed\s*&&\s*saveDecision\.allowed/,
  );
  assert.match(service, /can\(env, user, "project\.view"/);
  assert.match(service, /can\(env, user, "project\.map\.edit"/);
  assert.match(service, /can\(env, user, "project\.save"/);
  assert.match(permissions, /"project\.map\.edit"/);
});

test("DTO usa publicProject e organização sanitizada", () => {
  assert.match(service, /project:\s*publicProject\(project\)/);
  assert.match(
    service,
    /SELECT id, name, slug[\s\S]*FROM organizations/,
  );

  const responseSection = service.slice(
    service.indexOf("return {\n    policyVersion"),
  );
  assert.doesNotMatch(responseSection, /dropbox_root_path/);
  assert.doesNotMatch(responseSection, /default_config_file/);
  assert.doesNotMatch(responseSection, /password_hash/);
  assert.doesNotMatch(responseSection, /\bemail\b/);
});

test("endpoints aceitam somente GET e preservam erros estruturados", () => {
  for (const source of [endpoint, newMap]) {
    assert.match(source, /request\.method !== "GET"/);
    assert.match(source, /methodNotAllowed\(\["GET"\]\)/);
    assert.match(source, /error\?\.code/);
    assert.match(source, /error\?\.details/);
  }
});

test("abertura e negação produzem auditoria sem conteúdo do mapa", () => {
  assert.match(service, /projects\.map\.navigation\.read/);
  assert.match(service, /projects\.map\.viewer\.open/);
  assert.match(service, /projects\.map\.editor\.open/);
  assert.match(service, /projects\.map\.editor\.denied/);
  assert.match(service, /projects\.create\.workspace\.open/);
  assert.match(service, /projects\.create\.workspace\.denied/);
  assert.match(service, /projects\.create\.workspace\.limit_denied/);
  assert.match(creation, /projects\.create\.first_save/);
  assert.doesNotMatch(service, /datasets\s*:/);
  assert.doesNotMatch(service, /coordinates\s*:/);
});

test("rota create é canônica e aliases usam replace", () => {
  assert.match(routes, /path="\/maps\/new\/create"/);
  assert.match(
    routes,
    /path="\/maps\/new\/edit"[\s\S]*to="\/maps\/new\/create"[\s\S]*replace/,
  );
  assert.match(
    routes,
    /path="\/map"[\s\S]*to="\/maps\/new\/create"[\s\S]*replace/,
  );
  assert.match(provider, /pathname === "\/maps\/new\/create"/);
  assert.match(provider, /return "create"/);
  assert.match(api, /fetchNewMapCreateContext/);
  assert.match(api, /"\/maps\/new\/create"/);
});

test("contexto create é fail-closed e distinto de editor", () => {
  assert.match(service, /MAP_CREATE_ROUTE_V1/);
  assert.match(service, /MAP_CREATE_ROUTE_DISABLED/);
  assert.match(
    service,
    /mode:\s*MAP_PANEL_MODES\.CREATE/,
  );
  assert.match(
    service,
    /requestedMode:\s*MAP_PANEL_MODES\.CREATE/,
  );
  assert.match(
    service,
    /defaultPanel:\s*MAP_PANEL_MODES\.CREATE/,
  );
  assert.match(service, /createAllowed:\s*preflight\.allowed/);
  assert.match(permissions, /role === "super_admin"[\s\S]*allowed: true/);
  assert.match(
    permissions,
    /\(role === "admin" && relation\.isMember\)/,
  );
  assert.match(
    permissions,
    /\(role === "owner" && relation\.isOwner\)/,
  );
});
