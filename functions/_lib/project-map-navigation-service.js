import { requireSession } from "./auth.js";
import { isFeatureFlagEnabled } from "./organization-limit-service.js";
import { can, recordAuditLog } from "./permissions.js";
import {
  getAuthorizedProject,
  publicProject,
} from "./projects.js";
import {
  buildMapCapabilities,
  getMapPanelFeatures,
  MAP_PANEL_MODES,
} from "./map-panel-service.js";

export const EXISTING_PROJECT_NAVIGATION_POLICY_VERSION = 4;
export const PROJECT_CREATE_ROUTE_DEPRECATED =
  "PROJECT_CREATE_ROUTE_DEPRECATED";

function createNavigationError(message, status, code, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;

  if (details) {
    error.details = details;
  }

  return error;
}

function normalizeRequestedMode(value) {
  const mode = String(value ?? MAP_PANEL_MODES.MANAGE)
    .trim()
    .toLowerCase();

  if (
    mode === MAP_PANEL_MODES.MANAGE ||
    mode === MAP_PANEL_MODES.VIEWER ||
    mode === MAP_PANEL_MODES.EDITOR ||
    mode === MAP_PANEL_MODES.CREATE
  ) {
    return mode;
  }

  throw createNavigationError(
    "Modo de mapa inválido.",
    400,
    "MAP_MODE_INVALID",
    {
      requestedMode: mode,
      allowedModes: [
        MAP_PANEL_MODES.MANAGE,
        MAP_PANEL_MODES.VIEWER,
        MAP_PANEL_MODES.EDITOR,
      ],
    },
  );
}

function createAvailability({ viewerAllowed, editorAllowed, projectSlug }) {
  const encodedSlug = encodeURIComponent(projectSlug);

  return {
    viewer: {
      allowed: Boolean(viewerAllowed),
      route: viewerAllowed ? `/projects/${encodedSlug}/view` : null,
      reason: viewerAllowed ? null : "MAP_VIEW_FORBIDDEN",
    },
    editor: {
      allowed: Boolean(editorAllowed),
      route: editorAllowed ? `/projects/${encodedSlug}/edit` : null,
      reason: editorAllowed ? null : "MAP_EDITOR_FORBIDDEN",
    },
    create: {
      allowed: false,
      route: null,
      reason: PROJECT_CREATE_ROUTE_DEPRECATED,
    },
  };
}

function defaultExistingProjectPanel({ viewerAllowed, editorAllowed }) {
  if (editorAllowed) {
    return MAP_PANEL_MODES.EDITOR;
  }

  if (viewerAllowed) {
    return MAP_PANEL_MODES.VIEWER;
  }

  return null;
}

function resolveExistingMode({
  requestedMode,
  viewerAllowed,
  editorAllowed,
}) {
  const defaultPanel = defaultExistingProjectPanel({
    viewerAllowed,
    editorAllowed,
  });

  if (requestedMode === MAP_PANEL_MODES.CREATE) {
    return {
      allowed: false,
      resolvedMode: defaultPanel,
      defaultPanel,
      reason: PROJECT_CREATE_ROUTE_DEPRECATED,
      status: 410,
    };
  }

  if (requestedMode === MAP_PANEL_MODES.EDITOR) {
    return {
      allowed: Boolean(editorAllowed),
      resolvedMode: editorAllowed ? MAP_PANEL_MODES.EDITOR : defaultPanel,
      defaultPanel,
      reason: editorAllowed ? null : "MAP_EDITOR_FORBIDDEN",
      status: editorAllowed ? 200 : 403,
    };
  }

  if (requestedMode === MAP_PANEL_MODES.VIEWER) {
    return {
      allowed: Boolean(viewerAllowed),
      resolvedMode: viewerAllowed ? MAP_PANEL_MODES.VIEWER : defaultPanel,
      defaultPanel,
      reason: viewerAllowed ? null : "MAP_VIEW_FORBIDDEN",
      status: viewerAllowed ? 200 : 403,
    };
  }

  return {
    allowed: Boolean(defaultPanel),
    resolvedMode: defaultPanel,
    defaultPanel,
    reason: defaultPanel ? null : "MAP_VIEW_FORBIDDEN",
    status: defaultPanel ? 200 : 403,
  };
}

async function safeAudit(env, event) {
  try {
    await recordAuditLog(env, event);
  } catch (error) {
    console.error("[Maono project navigation] Falha de auditoria:", error);
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

function withBufferFeature(env, features) {
  return {
    ...features,
    maonoBuffer:
      features.maonoMapOverlay &&
      isFeatureFlagEnabled(env?.GEOPROCESSING_BUFFER_V1, false),
  };
}

export async function resolveCanonicalExistingProjectMapNavigation(
  env,
  request,
  slug,
  options = {},
) {
  const requestedMode = normalizeRequestedMode(options.requestedMode);
  const user = options.user || (await requireSession(env, request));
  const project = await getAuthorizedProject(env, user, slug);

  if (!project) {
    throw createNavigationError(
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
  const features = withBufferFeature(env, getMapPanelFeatures(env));
  const viewerAllowed = viewDecision.allowed;
  const mapEditAllowed = features.projectMapEditPermission
    ? mapEditDecision.allowed
    : saveDecision.allowed;
  const editorAllowed = viewerAllowed && mapEditAllowed && saveDecision.allowed;
  const modeDecision = resolveExistingMode({
    requestedMode,
    viewerAllowed,
    editorAllowed,
  });
  const availablePanels = createAvailability({
    viewerAllowed,
    editorAllowed,
    projectSlug: project.slug,
  });
  const auditBase = {
    actorUserId: user.id,
    organizationId: project.organization_id,
    projectId: project.id,
    resourceType: "project",
    resourceId: project.id,
    request,
  };

  if (!modeDecision.allowed) {
    await safeAudit(env, {
      ...auditBase,
      action:
        requestedMode === MAP_PANEL_MODES.CREATE
          ? "projects.map.legacy_create_route.denied"
          : requestedMode === MAP_PANEL_MODES.EDITOR
            ? "projects.map.editor.denied"
            : "projects.map.viewer.denied",
      result: "denied",
      metadata: {
        requestedMode,
        fallbackPanel: modeDecision.defaultPanel,
        reason: modeDecision.reason,
        policyVersion: EXISTING_PROJECT_NAVIGATION_POLICY_VERSION,
      },
    });

    const message =
      requestedMode === MAP_PANEL_MODES.CREATE
        ? "A rota de criação para projeto existente foi descontinuada. Use gerenciamento, edição ou visualização."
        : requestedMode === MAP_PANEL_MODES.EDITOR
          ? "Você não possui permissão para editar este mapa."
          : "Você não possui permissão para visualizar este mapa.";

    throw createNavigationError(
      message,
      modeDecision.status,
      modeDecision.reason,
      {
        requestedMode,
        fallbackPanel: modeDecision.defaultPanel,
        replacementRoute:
          requestedMode === MAP_PANEL_MODES.CREATE
            ? `/projects/${encodeURIComponent(project.slug)}/manage`
            : null,
        availablePanels,
      },
    );
  }

  const editableWorkspace =
    modeDecision.resolvedMode === MAP_PANEL_MODES.EDITOR;

  await safeAudit(env, {
    ...auditBase,
    action:
      requestedMode === MAP_PANEL_MODES.MANAGE
        ? "projects.map.navigation.read"
        : editableWorkspace
          ? "projects.map.editor.open"
          : "projects.map.viewer.open",
    result: "success",
    metadata: {
      requestedMode,
      resolvedMode: modeDecision.resolvedMode,
      policyVersion: EXISTING_PROJECT_NAVIGATION_POLICY_VERSION,
    },
  });

  const capabilities = buildMapCapabilities({
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
    openCreateWorkspaceAllowed: false,
    createProjectAllowed: false,
    initializeMapAllowed: false,
  });

  capabilities.previewBuffer = Boolean(features.maonoBuffer && viewerAllowed);
  capabilities.placeAnalysisMarker = Boolean(
    capabilities.previewIsochrone || capabilities.previewBuffer,
  );

  return {
    policyVersion: EXISTING_PROJECT_NAVIGATION_POLICY_VERSION,
    mode: modeDecision.resolvedMode,
    requestedMode,
    defaultPanel: modeDecision.defaultPanel,
    availablePanels,
    allowed: true,
    reason: null,
    capabilities,
    project: publicProject(project),
    organization: await getSafeOrganization(env, project.organization_id),
    version: Number(project.config_revision || 0),
    features,
  };
}
