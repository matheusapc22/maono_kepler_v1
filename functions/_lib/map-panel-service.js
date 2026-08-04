import { requireSession } from "./auth.js";
import { can, recordAuditLog } from "./permissions.js";
import {
  getActiveOrganizationId,
  getAuthorizedProject,
  publicProject,
} from "./projects.js";
import {
  assertCanOpenNewMapEditor,
  isFeatureFlagEnabled,
  isProjectQuotaReservationEnabled,
} from "./organization-limit-service.js";

export const MAP_PANEL_POLICY_VERSION = 2;
export const MAP_PANEL_MODES = Object.freeze({
  MANAGE: "manage",
  VIEWER: "viewer",
  EDITOR: "editor",
  CREATE: "create",
});

const MAP_CAPABILITY_KEYS = Object.freeze([
  "viewMap",
  "viewLayers",
  "openLayerPanel",
  "inspectLayer",
  "toggleLayerVisibility",
  "viewFilters",
  "focusMapData",
  "configureTooltips",
  "toggleLegend",
  "previewIsochrone",
  "persistIsochrone",
  "removeIsochrone",
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
  "openCreateWorkspace",
  "createProject",
  "initializeMap",
  "editMetadata",
  "editProjectMetadata",
  "updateThumbnail",
]);

function createMapPanelError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;

  if (details) {
    error.details = details;
  }

  return error;
}

function normalizeMode(value, fallback = MAP_PANEL_MODES.MANAGE) {
  const mode = String(value ?? "")
    .trim()
    .toLowerCase();

  if (!mode) {
    return fallback;
  }

  if (
    mode === MAP_PANEL_MODES.MANAGE ||
    mode === MAP_PANEL_MODES.VIEWER ||
    mode === MAP_PANEL_MODES.EDITOR ||
    mode === MAP_PANEL_MODES.CREATE
  ) {
    return mode;
  }

  throw createMapPanelError("Modo de mapa inválido.", 400, "MAP_MODE_INVALID", {
    requestedMode: mode,
    allowedModes: [
      MAP_PANEL_MODES.MANAGE,
      MAP_PANEL_MODES.VIEWER,
      MAP_PANEL_MODES.EDITOR,
      MAP_PANEL_MODES.CREATE,
    ],
  });
}

function emptyCapabilities() {
  return Object.fromEntries(MAP_CAPABILITY_KEYS.map((key) => [key, false]));
}

export function getMapPanelFeatures(env) {
  const maonoLayerManager = isFeatureFlagEnabled(
    env?.MAONO_LAYER_MANAGER_V1,
    false,
  );
  const maonoMapShell = isFeatureFlagEnabled(
    env?.MAONO_MAP_SHELL_V1,
    maonoLayerManager,
  );
  const maonoMapOverlay = isFeatureFlagEnabled(
    env?.MAONO_MAP_OVERLAY_V1,
    maonoLayerManager,
  );
  const isochroneProviderConfigured = Boolean(
    String(env?.GEOAPIFY_API_KEY || "").trim(),
  );

  return {
    mapManagementHome: isFeatureFlagEnabled(env?.MAP_MANAGEMENT_HOME_V1, false),
    mapPanelModes: isFeatureFlagEnabled(env?.MAP_PANEL_MODES_V1, false),
    projectMapEditPermission: isFeatureFlagEnabled(
      env?.PROJECT_MAP_EDIT_PERMISSION_V1,
      false,
    ),
    projectQuotaReservation: isProjectQuotaReservationEnabled(env),
    mapCreateRoute: isFeatureFlagEnabled(env?.MAP_CREATE_ROUTE_V1, false),
    maonoLayerManager,
    maonoMapShell,
    maonoMapOverlay,
    maonoIsochrone:
      maonoMapOverlay &&
      isochroneProviderConfigured &&
      isFeatureFlagEnabled(env?.MAONO_ISOCHRONE_V1, false),
  };
}

export function buildMapCapabilities({
  viewerAllowed = false,
  editorAllowed = false,
  editMetadataAllowed = false,
  updateThumbnailAllowed = false,
  focusMapDataAllowed = viewerAllowed,
  configureTooltipsAllowed = editorAllowed,
  toggleLegendAllowed = viewerAllowed,
  previewIsochroneAllowed = viewerAllowed,
  persistIsochroneAllowed = editorAllowed,
  removeIsochroneAllowed = editorAllowed,
  createAllowed = false,
  openCreateWorkspaceAllowed = createAllowed,
  createProjectAllowed = createAllowed,
  initializeMapAllowed = createAllowed,
} = {}) {
  const capabilities = emptyCapabilities();

  if (viewerAllowed) {
    capabilities.viewMap = true;
    capabilities.viewLayers = true;
    capabilities.openLayerPanel = true;
    capabilities.inspectLayer = true;
    capabilities.toggleLayerVisibility = true;
    capabilities.viewFilters = true;
    capabilities.focusMapData = Boolean(focusMapDataAllowed);
    capabilities.toggleLegend = Boolean(toggleLegendAllowed);
    capabilities.previewIsochrone = Boolean(previewIsochroneAllowed);
  }

  if (editorAllowed) {
    capabilities.configureTooltips = Boolean(configureTooltipsAllowed);
    capabilities.persistIsochrone = Boolean(persistIsochroneAllowed);
    capabilities.removeIsochrone = Boolean(removeIsochroneAllowed);
    capabilities.editLayers = true;
    capabilities.editStyle = true;
    capabilities.editLayerStyle = true;
    capabilities.createLayer = true;
    capabilities.removeLayer = true;
    capabilities.duplicateLayer = true;
    capabilities.reorderLayers = true;
    capabilities.manageFilters = true;
    capabilities.editFilters = true;
    capabilities.saveMap = true;
  }

  capabilities.openCreateWorkspace = Boolean(openCreateWorkspaceAllowed);
  capabilities.createProject = Boolean(createProjectAllowed);
  capabilities.initializeMap = Boolean(initializeMapAllowed);

  if (
    capabilities.openCreateWorkspace ||
    capabilities.createProject ||
    capabilities.initializeMap
  ) {
    capabilities.saveMap = true;
  }

  capabilities.editMetadata = Boolean(editMetadataAllowed);
  capabilities.editProjectMetadata = Boolean(editMetadataAllowed);
  capabilities.updateThumbnail = Boolean(updateThumbnailAllowed);

  return capabilities;
}

export function resolveMapPanelDecision({
  requestedMode = MAP_PANEL_MODES.MANAGE,
  viewerAllowed = false,
  editorAllowed = false,
  createAllowed = false,
  createDeniedReason = "PROJECT_CREATE_FORBIDDEN",
} = {}) {
  const requested = normalizeMode(requestedMode);
  const availablePanels = {
    viewer: Boolean(viewerAllowed),
    editor: Boolean(editorAllowed),
    create: Boolean(createAllowed),
  };
  const defaultPanel = createAllowed
    ? MAP_PANEL_MODES.CREATE
    : editorAllowed
      ? MAP_PANEL_MODES.EDITOR
      : viewerAllowed
        ? MAP_PANEL_MODES.VIEWER
        : null;
  let resolvedMode = defaultPanel;
  let allowed = Boolean(defaultPanel);
  let reason = allowed ? null : "MAP_VIEW_FORBIDDEN";

  if (requested === MAP_PANEL_MODES.VIEWER) {
    allowed = availablePanels.viewer;
    resolvedMode = allowed ? MAP_PANEL_MODES.VIEWER : defaultPanel;
    reason = allowed ? null : "MAP_VIEW_FORBIDDEN";
  } else if (requested === MAP_PANEL_MODES.EDITOR) {
    allowed = availablePanels.editor;
    resolvedMode = allowed ? MAP_PANEL_MODES.EDITOR : defaultPanel;
    reason = allowed ? null : "MAP_EDITOR_FORBIDDEN";
  } else if (requested === MAP_PANEL_MODES.CREATE) {
    allowed = availablePanels.create;
    resolvedMode = allowed ? MAP_PANEL_MODES.CREATE : defaultPanel;
    reason = allowed ? null : createDeniedReason;
  }

  return {
    requestedMode: requested,
    resolvedMode,
    defaultPanel,
    availablePanels,
    allowed,
    reason,
  };
}

function publicPanelAvailability(
  projectSlug,
  panel,
  createDeniedReason = "PROJECT_CREATE_FORBIDDEN",
) {
  const encodedSlug = encodeURIComponent(projectSlug);

  return {
    viewer: {
      allowed: panel.availablePanels.viewer,
      route: panel.availablePanels.viewer
        ? `/projects/${encodedSlug}/view`
        : null,
      reason: panel.availablePanels.viewer ? null : "MAP_VIEW_FORBIDDEN",
    },
    editor: {
      allowed: panel.availablePanels.editor,
      route: panel.availablePanels.editor
        ? `/projects/${encodedSlug}/edit`
        : null,
      reason: panel.availablePanels.editor ? null : "MAP_EDITOR_FORBIDDEN",
    },
    create: {
      allowed: panel.availablePanels.create,
      route: panel.availablePanels.create
        ? `/projects/${encodedSlug}/create`
        : null,
      reason: panel.availablePanels.create ? null : createDeniedReason,
    },
  };
}

async function safeAudit(env, event) {
  try {
    await recordAuditLog(env, event);
  } catch (error) {
    console.error("[Maono map panels] Falha de auditoria:", error);
  }
}

async function getSafeOrganization(env, organizationId) {
  if (!organizationId) return null;

  const organization = await env.DB.prepare(
    `SELECT id, name, slug
     FROM organizations
     WHERE id = ?
       AND active = 1
     LIMIT 1`,
  )
    .bind(organizationId)
    .first();

  return organization
    ? {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
      }
    : null;
}

function decisionContext(project) {
  return {
    project,
    projectId: project.id,
    projectSlug: project.slug,
    organizationId: project.organization_id,
    scopeType: "project",
  };
}

export async function resolveExistingProjectMapNavigation(
  env,
  request,
  slug,
  options = {},
) {
  const user = options.user || (await requireSession(env, request));
  const project = await getAuthorizedProject(env, user, slug);

  if (!project) {
    throw createMapPanelError(
      "Projeto não encontrado.",
      404,
      "PROJECT_NOT_FOUND",
    );
  }

  const context = decisionContext(project);
  const [
    viewDecision,
    saveDecision,
    mapEditDecision,
    metadataDecision,
    thumbnailDecision,
    createDecision,
  ] = await Promise.all([
    can(env, user, "project.view", context),
    can(env, user, "project.save", context),
    can(env, user, "project.map.edit", context),
    can(env, user, "project.edit", context),
    can(env, user, "project.thumbnail.update", context),
    can(env, user, "project.create", {
      organizationId: project.organization_id,
      scopeType: "organization",
    }),
  ]);
  const features = getMapPanelFeatures(env);
  const viewerAllowed = viewDecision.allowed;
  const mapEditAllowed = features.projectMapEditPermission
    ? mapEditDecision.allowed
    : saveDecision.allowed;
  const editorAllowed = viewerAllowed && mapEditAllowed && saveDecision.allowed;
  const createDeniedReason = !features.mapCreateRoute
    ? "MAP_CREATE_ROUTE_DISABLED"
    : !createDecision.allowed
      ? "PROJECT_CREATE_FORBIDDEN"
      : !editorAllowed
        ? "MAP_EDITOR_FORBIDDEN"
        : null;
  const createAllowed = createDeniedReason === null;
  const panel = resolveMapPanelDecision({
    requestedMode: options.requestedMode,
    viewerAllowed,
    editorAllowed,
    createAllowed,
    createDeniedReason: createDeniedReason || "PROJECT_CREATE_FORBIDDEN",
  });
  const auditBase = {
    actorUserId: user.id,
    organizationId: project.organization_id,
    projectId: project.id,
    resourceType: "project",
    resourceId: project.id,
    request,
  };

  if (!panel.allowed) {
    await safeAudit(env, {
      ...auditBase,
      action:
        panel.requestedMode === MAP_PANEL_MODES.CREATE
          ? "projects.map.create_workspace.denied"
          : panel.requestedMode === MAP_PANEL_MODES.EDITOR
            ? "projects.map.editor.denied"
            : "projects.map.viewer.denied",
      result: "denied",
      metadata: {
        requestedMode: panel.requestedMode,
        fallbackPanel: panel.defaultPanel,
        reason: panel.reason,
      },
    });

    throw createMapPanelError(
      panel.requestedMode === MAP_PANEL_MODES.CREATE
        ? "Você não possui permissão para abrir o modo de criação neste projeto."
        : panel.requestedMode === MAP_PANEL_MODES.EDITOR
          ? "Você não possui permissão para editar este mapa."
          : "Você não possui permissão para visualizar este mapa.",
      403,
      panel.reason,
      {
        requestedMode: panel.requestedMode,
        fallbackPanel: panel.defaultPanel,
        availablePanels: publicPanelAvailability(
          project.slug,
          panel,
          createDeniedReason || "PROJECT_CREATE_FORBIDDEN",
        ),
      },
    );
  }

  await safeAudit(env, {
    ...auditBase,
    action:
      panel.requestedMode === MAP_PANEL_MODES.MANAGE
        ? "projects.map.navigation.read"
        : panel.resolvedMode === MAP_PANEL_MODES.CREATE
          ? "projects.map.create_workspace.open"
          : panel.resolvedMode === MAP_PANEL_MODES.EDITOR
            ? "projects.map.editor.open"
            : "projects.map.viewer.open",
    result: "success",
    metadata: {
      requestedMode: panel.requestedMode,
      resolvedMode: panel.resolvedMode,
      policyVersion: MAP_PANEL_POLICY_VERSION,
    },
  });

  const editableWorkspace =
    panel.resolvedMode === MAP_PANEL_MODES.EDITOR ||
    panel.resolvedMode === MAP_PANEL_MODES.CREATE;
  const createWorkspace =
    createAllowed && panel.resolvedMode === MAP_PANEL_MODES.CREATE;

  return {
    policyVersion: MAP_PANEL_POLICY_VERSION,
    mode: panel.resolvedMode,
    requestedMode: panel.requestedMode,
    defaultPanel: panel.defaultPanel,
    availablePanels: publicPanelAvailability(
      project.slug,
      panel,
      createDeniedReason || "PROJECT_CREATE_FORBIDDEN",
    ),
    allowed: panel.allowed,
    reason: panel.reason,
    capabilities: buildMapCapabilities({
      viewerAllowed,
      editorAllowed: editorAllowed && editableWorkspace,
      editMetadataAllowed: metadataDecision.allowed && editableWorkspace,
      updateThumbnailAllowed: thumbnailDecision.allowed && editableWorkspace,
      focusMapDataAllowed: features.maonoMapOverlay && viewerAllowed,
      configureTooltipsAllowed:
        features.maonoMapOverlay && editorAllowed && editableWorkspace,
      toggleLegendAllowed: features.maonoMapOverlay && viewerAllowed,
      previewIsochroneAllowed: features.maonoIsochrone && viewerAllowed,
      persistIsochroneAllowed:
        features.maonoIsochrone && editorAllowed && editableWorkspace,
      removeIsochroneAllowed:
        features.maonoIsochrone && editorAllowed && editableWorkspace,
      openCreateWorkspaceAllowed: createWorkspace,
      createProjectAllowed: false,
      initializeMapAllowed: false,
    }),
    project: publicProject(project),
    organization: await getSafeOrganization(env, project.organization_id),
    version: Number(project.config_revision || 0),
    features,
  };
}

export async function resolveNewMapCreateContext(env, request, options = {}) {
  const user = options.user || (await requireSession(env, request));
  const organizationId = getActiveOrganizationId(user);

  if (!organizationId) {
    throw createMapPanelError(
      "Nenhuma organização ativa foi selecionada.",
      409,
      "ACTIVE_ORGANIZATION_REQUIRED",
    );
  }

  const createDecision = await can(env, user, "project.create", {
    organizationId,
    scopeType: "organization",
  });

  if (!createDecision.allowed) {
    await safeAudit(env, {
      actorUserId: user.id,
      organizationId,
      action: "projects.create.workspace.denied",
      resourceType: "organization",
      resourceId: organizationId,
      result: "denied",
      metadata: {
        reason: createDecision.reason,
      },
      request,
    });

    throw createMapPanelError(
      "Você não possui permissão para criar projetos.",
      403,
      "PROJECT_CREATE_FORBIDDEN",
    );
  }

  const features = getMapPanelFeatures(env);

  if (!features.mapCreateRoute) {
    await safeAudit(env, {
      actorUserId: user.id,
      organizationId,
      action: "projects.create.workspace.denied",
      resourceType: "organization",
      resourceId: organizationId,
      result: "denied",
      metadata: {
        reason: "MAP_CREATE_ROUTE_DISABLED",
      },
      request,
    });

    throw createMapPanelError(
      "A área de criação de mapas ainda não está habilitada.",
      404,
      "MAP_CREATE_ROUTE_DISABLED",
    );
  }

  const organization = await env.DB.prepare(
    `SELECT *
     FROM organizations
     WHERE id = ?
       AND active = 1
     LIMIT 1`,
  )
    .bind(organizationId)
    .first();

  if (!organization) {
    throw createMapPanelError(
      "Organização não encontrada.",
      404,
      "ORGANIZATION_NOT_FOUND",
    );
  }

  const preflight = await assertCanOpenNewMapEditor(env, organizationId, {
    organization,
  });
  const capabilities = buildMapCapabilities({
    viewerAllowed: preflight.allowed,
    editorAllowed: preflight.allowed,
    editMetadataAllowed: preflight.allowed,
    updateThumbnailAllowed: preflight.allowed,
    focusMapDataAllowed: features.maonoMapOverlay && preflight.allowed,
    configureTooltipsAllowed: features.maonoMapOverlay && preflight.allowed,
    toggleLegendAllowed: features.maonoMapOverlay && preflight.allowed,
    previewIsochroneAllowed: features.maonoIsochrone && preflight.allowed,
    persistIsochroneAllowed: features.maonoIsochrone && preflight.allowed,
    removeIsochroneAllowed: features.maonoIsochrone && preflight.allowed,
    createAllowed: preflight.allowed,
  });

  await safeAudit(env, {
    actorUserId: user.id,
    organizationId,
    action:
      preflight.reason === "ORGANIZATION_PROJECT_LIMIT_REACHED"
        ? "projects.create.workspace.limit_denied"
        : preflight.allowed
          ? "projects.create.workspace.open"
          : "projects.create.workspace.denied",
    resourceType: "organization",
    resourceId: organizationId,
    result: preflight.allowed ? "success" : "denied",
    metadata: {
      reason: preflight.reason,
      policyVersion: MAP_PANEL_POLICY_VERSION,
      projects: preflight.snapshot.projects,
    },
    request,
  });

  return {
    policyVersion: MAP_PANEL_POLICY_VERSION,
    mode: MAP_PANEL_MODES.CREATE,
    requestedMode: MAP_PANEL_MODES.CREATE,
    defaultPanel: MAP_PANEL_MODES.CREATE,
    availablePanels: {
      viewer: {
        allowed: false,
        route: null,
        reason: "NEW_PROJECT_NOT_PERSISTED",
      },
      editor: {
        allowed: false,
        route: null,
        reason: "NEW_PROJECT_NOT_PERSISTED",
      },
      create: {
        allowed: preflight.allowed,
        route: preflight.allowed ? "/maps/new/create" : null,
        reason: preflight.allowed ? null : preflight.reason,
      },
    },
    allowed: preflight.allowed,
    reason: preflight.reason,
    capabilities,
    project: null,
    organization: {
      id: preflight.snapshot.organization.id,
      name: preflight.snapshot.organization.name,
    },
    limits: {
      projects: preflight.snapshot.projects,
      storageMb: preflight.snapshot.storageMb,
    },
    constraints: {
      maxConfigBytes: 25 * 1024 * 1024,
      maxThumbnailBytes: 8 * 1024 * 1024,
      acceptedConfigContentTypes: ["application/json"],
      acceptedThumbnailContentTypes: ["image/png", "image/jpeg", "image/webp"],
    },
    features,
  };
}

export const resolveNewMapEditorContext = resolveNewMapCreateContext;
