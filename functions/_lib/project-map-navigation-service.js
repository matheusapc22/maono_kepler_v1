import {
  MAP_PANEL_MODES,
  resolveExistingProjectMapNavigation,
} from "./map-panel-service.js";

export const EXISTING_PROJECT_NAVIGATION_POLICY_VERSION = 3;
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

function deprecatedCreateAvailability() {
  return {
    allowed: false,
    route: null,
    reason: PROJECT_CREATE_ROUTE_DEPRECATED,
  };
}

function defaultExistingProjectPanel(availablePanels = {}) {
  if (availablePanels?.editor?.allowed) {
    return MAP_PANEL_MODES.EDITOR;
  }

  if (availablePanels?.viewer?.allowed) {
    return MAP_PANEL_MODES.VIEWER;
  }

  return null;
}

export function sanitizeExistingProjectNavigation(
  navigation,
  requestedMode = MAP_PANEL_MODES.MANAGE,
) {
  const availablePanels = {
    ...navigation.availablePanels,
    create: deprecatedCreateAvailability(),
  };
  const defaultPanel = defaultExistingProjectPanel(availablePanels);

  if (
    navigation.mode !== MAP_PANEL_MODES.EDITOR &&
    navigation.mode !== MAP_PANEL_MODES.VIEWER
  ) {
    throw createNavigationError(
      "Projeto existente não pode ser aberto em modo de criação.",
      502,
      "EXISTING_PROJECT_CREATE_MODE_INVALID",
      {
        requestedMode,
        fallbackPanel: defaultPanel,
        availablePanels,
      },
    );
  }

  return {
    ...navigation,
    policyVersion: Math.max(
      EXISTING_PROJECT_NAVIGATION_POLICY_VERSION,
      Number(navigation.policyVersion || 0),
    ),
    requestedMode,
    defaultPanel,
    availablePanels,
    capabilities: {
      ...navigation.capabilities,
      openCreateWorkspace: false,
      createProject: false,
      initializeMap: false,
    },
  };
}

function sanitizeNavigationError(error) {
  if (!error || typeof error !== "object") {
    return error;
  }

  const details = error.details;
  if (!details || typeof details !== "object") {
    return error;
  }

  const availablePanels = details.availablePanels
    ? {
        ...details.availablePanels,
        create: deprecatedCreateAvailability(),
      }
    : undefined;
  const fallbackPanel = defaultExistingProjectPanel(availablePanels);

  error.details = {
    ...details,
    ...(availablePanels ? { availablePanels } : {}),
    fallbackPanel,
  };

  return error;
}

async function openExplicitProjectMode(
  env,
  request,
  slug,
  mode,
  requestedMode,
  options,
) {
  try {
    const navigation = await resolveExistingProjectMapNavigation(
      env,
      request,
      slug,
      {
        ...options,
        requestedMode: mode,
      },
    );

    return sanitizeExistingProjectNavigation(navigation, requestedMode);
  } catch (error) {
    throw sanitizeNavigationError(error);
  }
}

function isEditorDenied(error) {
  return (
    Number(error?.status || 0) === 403 &&
    String(error?.code || "") === "MAP_EDITOR_FORBIDDEN"
  );
}

export async function resolveCanonicalExistingProjectMapNavigation(
  env,
  request,
  slug,
  options = {},
) {
  const requestedMode = normalizeRequestedMode(options.requestedMode);

  if (requestedMode === MAP_PANEL_MODES.CREATE) {
    // Preserva autenticação/visibilidade antes de expor o redirect de legado.
    await openExplicitProjectMode(
      env,
      request,
      slug,
      MAP_PANEL_MODES.VIEWER,
      MAP_PANEL_MODES.VIEWER,
      options,
    );

    throw createNavigationError(
      "A rota de criação para projeto existente foi descontinuada. Use a rota de gerenciamento, edição ou visualização.",
      410,
      PROJECT_CREATE_ROUTE_DEPRECATED,
      {
        requestedMode: MAP_PANEL_MODES.CREATE,
        fallbackPanel: null,
        replacementRoute: `/projects/${encodeURIComponent(slug)}/manage`,
        availablePanels: {
          create: deprecatedCreateAvailability(),
        },
      },
    );
  }

  if (requestedMode === MAP_PANEL_MODES.MANAGE) {
    try {
      return await openExplicitProjectMode(
        env,
        request,
        slug,
        MAP_PANEL_MODES.EDITOR,
        MAP_PANEL_MODES.MANAGE,
        options,
      );
    } catch (error) {
      if (!isEditorDenied(error)) {
        throw error;
      }

      return openExplicitProjectMode(
        env,
        request,
        slug,
        MAP_PANEL_MODES.VIEWER,
        MAP_PANEL_MODES.MANAGE,
        options,
      );
    }
  }

  return openExplicitProjectMode(
    env,
    request,
    slug,
    requestedMode,
    requestedMode,
    options,
  );
}
