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
  clientApi: new URL(
    "../src/pages/Kepler/map-panel/map-panel-api.ts",
    import.meta.url,
  ),
};

const [service, endpoint, newMap, permissions, clientApi] = await Promise.all(
  Object.values(urls).map((url) => readFile(url, "utf8")),
);

test("política versionada prioriza create, depois editor e viewer", () => {
  assert.equal(MAP_PANEL_POLICY_VERSION, 3);

  assert.deepEqual(
    resolveMapPanelDecision({
      requestedMode: "manage",
      viewerAllowed: true,
      editorAllowed: true,
      createAllowed: true,
    }),
    {
      requestedMode: "manage",
      resolvedMode: "create",
      defaultPanel: "create",
      availablePanels: {
        viewer: true,
        editor: true,
        create: true,
      },
      allowed: true,
      reason: null,
    },
  );

  assert.equal(
    resolveMapPanelDecision({
      requestedMode: "manage",
      viewerAllowed: true,
      editorAllowed: true,
      createAllowed: false,
    }).resolvedMode,
    "editor",
  );

  assert.equal(
    resolveMapPanelDecision({
      requestedMode: "manage",
      viewerAllowed: true,
      editorAllowed: false,
      createAllowed: false,
    }).resolvedMode,
    "viewer",
  );
});

test("modos explícitos continuam respeitados", () => {
  assert.equal(
    resolveMapPanelDecision({
      requestedMode: "viewer",
      viewerAllowed: true,
      editorAllowed: true,
      createAllowed: true,
    }).resolvedMode,
    "viewer",
  );

  assert.equal(
    resolveMapPanelDecision({
      requestedMode: "editor",
      viewerAllowed: true,
      editorAllowed: true,
      createAllowed: true,
    }).resolvedMode,
    "editor",
  );

  assert.equal(
    resolveMapPanelDecision({
      requestedMode: "create",
      viewerAllowed: true,
      editorAllowed: true,
      createAllowed: true,
    }).resolvedMode,
    "create",
  );
});

test("create negado mantém fallback explícito sem ampliar acesso", () => {
  const decision = resolveMapPanelDecision({
    requestedMode: "create",
    viewerAllowed: true,
    editorAllowed: true,
    createAllowed: false,
    createDeniedReason: "PROJECT_CREATE_FORBIDDEN",
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "PROJECT_CREATE_FORBIDDEN");
  assert.equal(decision.defaultPanel, "editor");
  assert.deepEqual(decision.availablePanels, {
    viewer: true,
    editor: true,
    create: false,
  });
});

test("editor negado recebe fallback explícito para viewer", () => {
  const decision = resolveMapPanelDecision({
    requestedMode: "editor",
    viewerAllowed: true,
    editorAllowed: false,
    createAllowed: false,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, "MAP_EDITOR_FORBIDDEN");
  assert.equal(decision.defaultPanel, "viewer");
  assert.deepEqual(decision.availablePanels, {
    viewer: true,
    editor: false,
    create: false,
  });
});

test("viewer negado usa o código público padronizado", () => {
  const decision = resolveMapPanelDecision({
    requestedMode: "viewer",
    viewerAllowed: false,
    editorAllowed: false,
    createAllowed: false,
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
  assert.equal(capabilities.persistBuffer, false);

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
    "persistBuffer",
    "openCreateWorkspace",
    "createProject",
    "initializeMap",
    "editProjectMetadata",
    "updateThumbnail",
  ]) {
    assert.equal(capabilities[capability], false, capability);
  }
});

test("editor recebe comandos persistentes sem capacidades exclusivas de criação", () => {
  const capabilities = buildMapCapabilities({
    viewerAllowed: true,
    editorAllowed: true,
    editMetadataAllowed: true,
    updateThumbnailAllowed: true,
  });

  const createOnlyCapabilities = new Set([
    "openCreateWorkspace",
    "createProject",
    "initializeMap",
  ]);

  for (const [capability, allowed] of Object.entries(capabilities)) {
    assert.equal(
      allowed,
      !createOnlyCapabilities.has(capability),
      capability,
    );
  }
});

test("create de projeto existente não cria cópia nem reinicializa o mapa", () => {
  const capabilities = buildMapCapabilities({
    viewerAllowed: true,
    editorAllowed: true,
    editMetadataAllowed: true,
    updateThumbnailAllowed: true,
    openCreateWorkspaceAllowed: true,
    createProjectAllowed: false,
    initializeMapAllowed: false,
  });

  assert.equal(capabilities.viewMap, true);
  assert.equal(capabilities.editLayers, true);
  assert.equal(capabilities.saveMap, true);
  assert.equal(capabilities.openCreateWorkspace, true);
  assert.equal(capabilities.createProject, false);
  assert.equal(capabilities.initializeMap, false);
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
    maonoBuffer: false,
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
      GEOPROCESSING_BUFFER_V1: "true",
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
      maonoBuffer: true,
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

test("create existente exige editar, salvar e criar na organização", () => {
  assert.match(
    service,
    /viewerAllowed\s*&&\s*mapEditAllowed\s*&&\s*saveDecision\.allowed/,
  );
  assert.match(service, /can\(env, user, "project\.view"/);
  assert.match(service, /can\(env, user, "project\.map\.edit"/);
  assert.match(service, /can\(env, user, "project\.save"/);
  assert.match(service, /can\(env, user, "project\.create", \{[\s\S]*scopeType: "organization"/);
  assert.match(service, /const createAllowed = createDeniedReason === null/);
  assert.match(permissions, /"project\.map\.edit"/);
});

test("rota create existente preserva slug e contrato de atualização", () => {
  assert.match(service, /`\/projects\/\$\{encodedSlug\}\/create`/);
  assert.match(clientApi, /`\/projects\/\$\{encodeURIComponent\(projectSlug\)\}\/create`/);
  assert.match(clientApi, /project\s*\?[\s\S]*capabilities\.viewMap[\s\S]*capabilities\.editLayers/);
  assert.match(service, /createProjectAllowed:\s*false/);
  assert.match(service, /initializeMapAllowed:\s*false/);
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
    assert.match(
      source,
      /methodNotAllowed\(\["GET"\](?:,\s*\{\s*correlationId\s*\})?\)/,
    );
    assert.match(source, /error\?\.code/);
    assert.match(source, /error\?\.details/);
  }
});

test("abertura e negação produzem auditoria sem conteúdo do mapa", () => {
  assert.match(service, /projects\.map\.navigation\.read/);
  assert.match(service, /projects\.map\.viewer\.open/);
  assert.match(service, /projects\.map\.editor\.open/);
  assert.match(service, /projects\.map\.editor\.denied/);
  assert.match(service, /projects\.map\.create_workspace\.open/);
  assert.match(service, /projects\.map\.create_workspace\.denied/);

  assert.match(service, /projects\.create\.workspace\.open/);
  assert.match(service, /projects\.create\.workspace\.denied/);
  assert.match(service, /projects\.create\.workspace\.limit_denied/);

  assert.doesNotMatch(service, /datasets\s*:/);
  assert.doesNotMatch(service, /coordinates\s*:/);
});
