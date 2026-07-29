import type {
  MapPanelApiError,
  MapPanelContextValue,
  MapNavigationMode,
} from "./types";

function normalizeAvailability(
  value: any,
  fallbackRoute: string | null,
) {
  if (value && typeof value === "object") {
    return {
      allowed: Boolean(value.allowed),
      route: value.route || null,
      reason: value.reason || null,
    };
  }

  return {
    allowed: Boolean(value),
    route: value ? fallbackRoute : null,
    reason: value ? null : "PANEL_NOT_AVAILABLE",
  };
}

async function readJson(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    const error = new Error(
      "A API de navegação retornou uma resposta inválida.",
    ) as MapPanelApiError;
    error.status = response.status;
    error.code = "INVALID_MAP_PANEL_RESPONSE";
    throw error;
  }
}

async function requestMapContext(
  url: string,
  signal?: AbortSignal,
): Promise<MapPanelContextValue> {
  const response = await fetch(url, {
    method: "GET",
    credentials: "include",
    headers: {
      Accept: "application/json",
    },
    signal,
  });
  const data = await readJson(response);

  if (!response.ok || !data?.ok) {
    const error = new Error(
      data?.error?.message ||
        "Não foi possível resolver o painel deste mapa.",
    ) as MapPanelApiError;
    error.status = response.status;
    error.code = data?.error?.code || "MAP_PANEL_REQUEST_FAILED";
    error.details = data?.error?.details || null;
    throw error;
  }

  const context = data.navigation || data.context || data;

  if (!context || typeof context !== "object") {
    const error = new Error(
      "O contexto do mapa não foi retornado.",
    ) as MapPanelApiError;
    error.status = 502;
    error.code = "MAP_PANEL_CONTEXT_MISSING";
    throw error;
  }

  const projectSlug = context.project?.slug;

  return {
    ...context,
    allowed: context.allowed !== false,
    reason: context.reason || null,
    availablePanels: {
      viewer: normalizeAvailability(
        context.availablePanels?.viewer,
        projectSlug
          ? `/projects/${encodeURIComponent(projectSlug)}/view`
          : null,
      ),
      editor: normalizeAvailability(
        context.availablePanels?.editor,
        projectSlug
          ? `/projects/${encodeURIComponent(projectSlug)}/edit`
          : null,
      ),
      create: normalizeAvailability(
        context.availablePanels?.create,
        "/maps/new/create",
      ),
    },
  } as MapPanelContextValue;
}

export function fetchProjectMapNavigation(
  projectSlug: string,
  mode: MapNavigationMode,
  signal?: AbortSignal,
) {
  return requestMapContext(
    `/api/projects/${encodeURIComponent(
      projectSlug,
    )}/map-navigation?mode=${encodeURIComponent(mode)}`,
    signal,
  );
}

export function fetchNewMapCreateContext(signal?: AbortSignal) {
  return requestMapContext("/api/maps/new/context", signal);
}

export const fetchNewMapContext = fetchNewMapCreateContext;
