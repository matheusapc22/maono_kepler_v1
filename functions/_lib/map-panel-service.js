import { requireSession } from "./auth.js";
import {
  can,
  recordAuditLog,
} from "./permissions.js";
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

export const MAP_PANEL_POLICY_VERSION = 1;
export const MAP_PANEL_MODES = Object.freeze({
  MANAGE: "manage",
  VIEWER: "viewer",
  EDITOR: "editor",
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
  "editMetadata",
  "editProjectMetadata",
  "updateThumbnail",
]);

function createMapPanelError(
  message,
  status,
  code,
  details = null,
) {
  const error = new Error(message);
  error.status = status;
  error.code = code;

  if (details) {
    error.details = details;
  }

  return error;
}

function normalizeMode(value, fallback = MAP_PANEL_MODES.MANAGE) {
  const mode = String(value ?? "").trim().toLowerCase();

  if (!mode) {
    return fallback;
  }

  if (
    mode === MAP_PANEL_MODES.MANAGE ||
    mode === MAP_PANEL_MODES.VIEWER ||
    mode === MAP_PANEL_MODES.EDITOR
  ) {
    return mode;
  }

  throw createMapPanelError(
    "Modo de mapa inválido.",
    400,
    "MAP_MODE_INVALID",
    {
      requestedMode: mode,
      allowedModes: Object.values(MAP_PANEL_MODES),
    },
  );
}

function emptyCapabilities() {
  return Object.fromEntries(
    MAP_CAPABILITY_KEYS.map((key) => [key, false]),
  );
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
    mapManagementHome: isFeatureFlagEnabled(
      env?.MAP_MANAGEMENT_HOME_V1,
      false,
    ),
    mapPanelModes: isFeatureFlagEnabled(
      env?.MAP_PANEL_MODES_V1,
      false,
    ),
    projectMapEditPermission: isFeatureFlagEnabled(
      env?.PROJECT_MAP_EDIT_PERMISSION_V1,
      false,
    ),
    projectQuotaReservation: isProjectQuotaReservationEnabled(env),
    maonoLayerManager,
    maonoMapShell,
    maonoMapOverlay,
    maonoIsochrone:
      maonoMapOverlay &&
      isochroneProviderConfigured &&
      isFeatureFlagEnabled(
        env?.MAONO_ISOCHRONE_V1,
        false,
      ),
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
    capabilities.previewIsochrone = Boolean(
      previewIsochroneAllowed,
    );
  }

  if (editorAllowed) {
    capabilities.configureTooltips = Boolean(
      configureTooltipsAllowed,
    );
    capabilities.persistIsochrone = Boolean(
      persistIsochroneAllowed,
    );
    capabilities.removeIsochrone = Boolean(
      removeIsochroneAllowed,
    );
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

  capabilities.editMetadata = Boolean(editMetadataAllowed);
  capabilities.editProjectMetadata = Boolean(editMetadataAllowed);
  capabilities.updateThumbnail = Boolean(updateThumbnailAllowed);

  return capabilities;
}

export function resolveMapPanelDecision({
  requestedMode = MAP_PANEL_MODES.MANAGE,
  viewerAllowed = false,
  editorAllowed = false,
} = {}) {
  const requested = normalizeMode(requestedMode);
  const availablePanels = {
    viewer: Boolean(viewerAllowed),
    editor: Boolean(editorAllowed),
  };
  const defaultPanel = viewerAllowed
    ? MAP_PANEL_MODES.VIEWER
    : editorAllowed
      ? MAP_PANEL_MODES.EDITOR
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

function publicPanelAvailability(projectSlug, panel) {
  const encodedSlug = encodeURIComponent(projectSlug);

  return {
    viewer: {
      allowed: panel.availablePanels.viewer,
      route: panel.availablePanels.viewer
        ? `/projects/${encodedSlug}/view`
        : null,
      reason: panel.availablePanels.viewer
        ? null
        : "MAP_VIEW_FORBIDDEN",
    },
    editor: {
      allowed: panel.availablePanels.editor,
      route: panel.availablePanels.editor
        ? `/projects/${encodedSlug}/edit`
        : null,
      reason: panel.availablePanels.editor
        ? null
        : "MAP_EDITOR_FORBIDDEN",
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
  const user = options.user || await requireSession(env, request);
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
  ] = await Promise.all([
    can(env, user, "project.view", context),
    can(env, user, "project.save", context),
    can(env, user, "project.map.edit", context),
    can(env, user, "project.edit", context),
    can(env, user, "project.thumbnail.update", context),
  ]);
  const features = getMapPanelFeatures(env);
  const viewerAllowed = viewDecision.allowed;
  const mapEditAllowed = features.projectMapEditPermission
    ? mapEditDecision.allowed
    : saveDecision.allowed;
  const editorAllowed =
    viewerAllowed &&
    mapEditAllowed &&
    saveDecision.allowed;
  const panel = resolveMapPanelDecision({
    requestedMode: options.requestedMode,
    viewerAllowed,
    editorAllowed,
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
        panel.requestedMode === MAP_PANEL_MODES.EDITOR
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
      panel.requestedMode === MAP_PANEL_MODES.EDITOR
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
        ),
      },
    );
  }

  await safeAudit(env, {
    ...auditBase,
    action:
      panel.requestedMode === MAP_PANEL_MODES.MANAGE
        ? "projects.map.navigation.read"
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

  return {
    policyVersion: MAP_PANEL_POLICY_VERSION,
    mode: panel.resolvedMode,
    requestedMode: panel.requestedMode,
    defaultPanel: panel.defaultPanel,
    availablePanels: publicPanelAvailability(
      project.slug,
      panel,
    ),
    capabilities: buildMapCapabilities({
      viewerAllowed,
      editorAllowed:
        editorAllowed &&
        panel.resolvedMode === MAP_PANEL_MODES.EDITOR,
      editMetadataAllowed:
        metadataDecision.allowed &&
        panel.resolvedMode === MAP_PANEL_MODES.EDITOR,
      updateThumbnailAllowed:
        thumbnailDecision.allowed &&
        panel.resolvedMode === MAP_PANEL_MODES.EDITOR,
      focusMapDataAllowed:
        features.maonoMapOverlay && viewerAllowed,
      configureTooltipsAllowed:
        features.maonoMapOverlay &&
        editorAllowed &&
        panel.resolvedMode === MAP_PANEL_MODES.EDITOR,
      toggleLegendAllowed:
        features.maonoMapOverlay && viewerAllowed,
      previewIsochroneAllowed:
        features.maonoIsochrone && viewerAllowed,
      persistIsochroneAllowed:
        features.maonoIsochrone &&
        editorAllowed &&
        panel.resolvedMode === MAP_PANEL_MODES.EDITOR,
      removeIsochroneAllowed:
        features.maonoIsochrone &&
        editorAllowed &&
        panel.resolvedMode === MAP_PANEL_MODES.EDITOR,
    }),
    project: publicProject(project),
    organization: await getSafeOrganization(
      env,
      project.organization_id,
    ),
    version: Number(project.config_revision || 0),
    features,
  };
}

export async function resolveNewMapEditorContext(
  env,
  request,
  options = {},
) {
  const user = options.user || await requireSession(env, request);
  const organizationId = getActiveOrganizationId(user);

  if (!organizationId) {
    throw createMapPanelError(
      "Nenhuma organização ativa foi selecionada.",
      409,
      "ACTIVE_ORGANIZATION_REQUIRED",
    );
  }

  const createDecision = await can(
    env,
    user,
    "project.create",
    {
      organizationId,
      scopeType: "organization",
    },
  );

  if (!createDecision.allowed) {
    await safeAudit(env, {
      actorUserId: user.id,
      organizationId,
      action: "projects.create.preflight",
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

  const preflight = await assertCanOpenNewMapEditor(
    env,
    organizationId,
    { organization },
  );
  const features = getMapPanelFeatures(env);
  const capabilities = buildMapCapabilities({
    viewerAllowed: preflight.allowed,
    editorAllowed: preflight.allowed,
    editMetadataAllowed: preflight.allowed,
    updateThumbnailAllowed: preflight.allowed,
    focusMapDataAllowed:
      features.maonoMapOverlay && preflight.allowed,
    configureTooltipsAllowed:
      features.maonoMapOverlay && preflight.allowed,
    toggleLegendAllowed:
      features.maonoMapOverlay && preflight.allowed,
    previewIsochroneAllowed:
      features.maonoIsochrone && preflight.allowed,
    persistIsochroneAllowed:
      features.maonoIsochrone && preflight.allowed,
    removeIsochroneAllowed:
      features.maonoIsochrone && preflight.allowed,
  });

  await safeAudit(env, {
    actorUserId: user.id,
    organizationId,
    action:
      preflight.reason === "ORGANIZATION_PROJECT_LIMIT_REACHED"
        ? "projects.create.limit_denied"
        : "projects.create.preflight",
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
    mode: MAP_PANEL_MODES.EDITOR,
    requestedMode: MAP_PANEL_MODES.EDITOR,
    defaultPanel: MAP_PANEL_MODES.EDITOR,
    availablePanels: {
      viewer: {
        allowed: false,
        route: null,
        reason: "NEW_PROJECT_NOT_PERSISTED",
      },
      editor: {
        allowed: preflight.allowed,
        route: preflight.allowed ? "/maps/new/edit" : null,
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
      acceptedConfigContentTypes: [
        "application/json",
      ],
      acceptedThumbnailContentTypes: [
        "image/png",
        "image/jpeg",
        "image/webp",
      ],
    },
    features,
  };
}
