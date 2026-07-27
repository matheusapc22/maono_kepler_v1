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
};

const [service, endpoint, newMap, permissions] = await Promise.all(
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

test("editor recebe todos os comandos previstos", () => {
  const capabilities = buildMapCapabilities({
    viewerAllowed: true,
    editorAllowed: true,
    editMetadataAllowed: true,
    updateThumbnailAllowed: true,
  });

  assert.ok(Object.values(capabilities).every(Boolean));
});

test("feature flags têm rollback seguro e opt-in", () => {
  assert.deepEqual(getMapPanelFeatures({}), {
    mapManagementHome: false,
    mapPanelModes: false,
    projectMapEditPermission: false,
    projectQuotaReservation: false,
    maonoLayerManager: false,
  });
  assert.deepEqual(
    getMapPanelFeatures({
      MAP_MANAGEMENT_HOME_V1: "true",
      MAP_PANEL_MODES_V1: "1",
      PROJECT_MAP_EDIT_PERMISSION_V1: "on",
      PROJECT_QUOTA_RESERVATION_V1: "yes",
      MAONO_LAYER_MANAGER_V1: "true",
    }),
    {
      mapManagementHome: true,
      mapPanelModes: true,
      projectMapEditPermission: true,
      projectQuotaReservation: true,
      maonoLayerManager: true,
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
  assert.match(service, /projects\.create\.preflight/);
  assert.doesNotMatch(service, /datasets\s*:/);
  assert.doesNotMatch(service, /coordinates\s*:/);
});
