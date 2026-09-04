import { requireSession } from "./auth.js";
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
import {
  getProjectMapRoutePath,
  PROJECT_MAP_ROUTE_MODES,
  resolveEffectiveProjectMapRoute,
} from "./project-map-route-policy.js";

export const EXISTING_PROJECT_NAVIGATION_POLICY_VERSION = 6;
export const PROJECT_CREATE_ROUTE_DEPRECATED =
  "PROJECT_CREATE_ROUTE_DEPRECATED";
export const PROJECT_MAP_ROUTE_NOT_ASSIGNED =
  "PROJECT_MAP_ROUTE_NOT_ASSIGNED";

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

function createAvailability({
  assignedMode,
  assignedModeAllowed,
  assignedModeReason,
  projectSlug,
}) {
  const encodedSlug = encodeURIComponent(projectSlug);
  const viewerAssigned = assignedMode === PROJECT_MAP_ROUTE_MODES.VIEWER;
  const editorAssigned = assignedMode === PROJECT_MAP_ROUTE_MODES.EDITOR;

  return {
    viewer: {
      allowed: viewerAssigned && Boolean(assignedModeAllowed),
      route:
        viewerAssigned && assignedModeAllowed
          ? `/projects/${encodedSlug}/view`
          : null,
      reason: viewerAssigned
        ? assignedModeAllowed
          ? null
          : assignedModeReason || "MAP_VIEW_FORBIDDEN"
        : PROJECT_MAP_ROUTE_NOT_ASSIGNED,
    },
    editor: {
      allowed: editorAssigned && Boolean(assignedModeAllowed),
      route:
        editorAssigned && assignedModeAllowed
          ? `/projects/${encodedSlug}/edit`
          : null,
      reason: editorAssigned
        ? assignedModeAllowed
          ? null
          : assignedModeReason || "MAP_EDITOR_FORBIDDEN"
        : PROJECT_MAP_ROUTE_NOT_ASSIGNED,
    },
    create: {
      allowed: false,
      route: null,
      reason: PROJECT_CREATE_ROUTE_DEPRECATED,
    },
  };
}

function resolveExistingMode({
  requestedMode,
  assignedMode,
  assignedModeAllowed,
  assignedModeReason,
}) {
  const defaultPanel = assignedMode || null;

  if (requestedMode === MAP_PANEL_MODES.CREATE) {
    return {
      allowed: false,
      resolvedMode: defaultPanel,
      defaultPanel,
      reason: PROJECT_CREATE_ROUTE_DEPRECATED,
      status: 410,
    };
  }

  if (!assignedMode) {
    return {
      allowed: false,
      resolvedMode: null,
      defaultPanel: null,
      reason: "PROJECT_MAP_ROUTE_REQUIRED",
      status: 403,
    };
  }

  if (
    requestedMode === MAP_PANEL_MODES.VIEWER ||
    requestedMode === MAP_PANEL_MODES.EDITOR
  ) {
    if (requestedMode !== assignedMode) {
      return {
        allowed: false,
        resolvedMode: assignedMode,
        defaultPanel: assignedMode,
        reason: PROJECT_MAP_ROUTE_NOT_ASSIGNED,
        status: 403,
      };
    }

    return {
      allowed: Boolean(assignedModeAllowed),
      resolvedMode: assignedMode,
      defaultPanel: assignedMode,
      reason: assignedModeAllowed ? null : assignedModeReason,
      status: assignedModeAllowed ? 200 : 403,
    };
  }

  return {
    allowed: Boolean(assignedModeAllowed),
    resolvedMode: assignedMode,
    defaultPanel: assignedMode,
    reason: assignedModeAllowed ? null : assignedModeReason,
    status: assignedModeAllowed ? 200 : 403,
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

  const routePolicy = resolveEffectiveProjectMapRoute(user, project);
  const assignedMode = routePolicy.mode;
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
  const canViewMap = viewDecision.allowed;
  const mapEditAllowed = features.projectMapEditPermission
    ? mapEditDecision.allowed
    : saveDecision.allowed;
  const editorCapabilitiesAllowed =
    canViewMap && mapEditAllowed && saveDecision.allowed;
  const assignedModeAllowed =
    assignedMode === PROJECT_MAP_ROUTE_MODES.VIEWER
      ? canViewMap
      : assignedMode === PROJECT_MAP_ROUTE_MODES.EDITOR
        ? editorCapabilitiesAllowed
        : false;
  const assignedModeReason =
    assignedMode === PROJECT_MAP_ROUTE_MODES.EDITOR
      ? "MAP_EDITOR_FORBIDDEN"
      : "MAP_VIEW_FORBIDDEN";
  const modeDecision = resolveExistingMode({
    requestedMode,
    assignedMode,
    assignedModeAllowed,
    assignedModeReason,
  });
  const availablePanels = createAvailability({
    assignedMode,
    assignedModeAllowed,
    assignedModeReason,
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
        assignedMode,
        routePolicySource: routePolicy.source,
        fallbackPanel: modeDecision.defaultPanel,
        reason: modeDecision.reason,
        policyVersion: EXISTING_PROJECT_NAVIGATION_POLICY_VERSION,
      },
    });

    const message =
      requestedMode === MAP_PANEL_MODES.CREATE
        ? "A rota de criação para projeto existente foi descontinuada. Use gerenciamento, edição ou visualização."
        : modeDecision.reason === PROJECT_MAP_ROUTE_NOT_ASSIGNED
          ? "Este projeto está atribuído a outro modo de acesso ao mapa."
          : requestedMode === MAP_PANEL_MODES.EDITOR
            ? "Você não possui permissão para editar este mapa."
            : "Você não possui permissão para visualizar este mapa.";

    throw createNavigationError(
      message,
      modeDecision.status,
      modeDecision.reason,
      {
        requestedMode,
        assignedMode,
        fallbackPanel: modeDecision.defaultPanel,
        replacementRoute:
          requestedMode === MAP_PANEL_MODES.CREATE
            ? `/projects/${encodeURIComponent(project.slug)}/manage`
            : getProjectMapRoutePath(project.slug, assignedMode),
        availablePanels,
      },
    );
  }

  const editableWorkspace =
    modeDecision.resolvedMode === MAP_PANEL_MODES.EDITOR;
  const viewerWorkspace =
    modeDecision.resolvedMode === MAP_PANEL_MODES.VIEWER;

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
      assignedMode,
      routePolicySource: routePolicy.source,
      resolvedMode: modeDecision.resolvedMode,
      policyVersion: EXISTING_PROJECT_NAVIGATION_POLICY_VERSION,
    },
  });

  const capabilities = {
    ...buildMapCapabilities({
      viewerAllowed: canViewMap,
      editorAllowed: editorCapabilitiesAllowed && editableWorkspace,
      editMetadataAllowed: metadataDecision.allowed && editableWorkspace,
      updateThumbnailAllowed: thumbnailDecision.allowed && editableWorkspace,
      focusMapDataAllowed: features.maonoMapOverlay && canViewMap,
      configureTooltipsAllowed:
        features.maonoMapOverlay && editorCapabilitiesAllowed && editableWorkspace,
      toggleLegendAllowed: features.maonoMapOverlay && canViewMap,
      previewIsochroneAllowed: features.maonoIsochrone && canViewMap,
      previewBufferAllowed: features.maonoBuffer && canViewMap,
      persistIsochroneAllowed:
        features.maonoIsochrone && editorCapabilitiesAllowed && editableWorkspace,
      persistBufferAllowed:
        features.maonoBuffer && editorCapabilitiesAllowed && editableWorkspace,
      removeIsochroneAllowed:
        features.maonoIsochrone && editorCapabilitiesAllowed && editableWorkspace,
      openCreateWorkspaceAllowed: false,
      createProjectAllowed: false,
      initializeMapAllowed: false,
    }),
    requestProjectChange: viewerWorkspace && canViewMap,
    reviewProjectChange: false,
    applyProjectChange: false,
  };

  return {
    policyVersion: EXISTING_PROJECT_NAVIGATION_POLICY_VERSION,
    mode: modeDecision.resolvedMode,
    requestedMode,
    assignedMode,
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