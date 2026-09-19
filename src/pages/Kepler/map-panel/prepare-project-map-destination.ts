import {
  fetchProjectMapNavigation,
} from "./map-panel-api";
import {
  primeMapPanelContextHandoff,
} from "./map-panel-context-handoff";
import type {
  MapPanelApiError,
  MapPanelContextValue,
} from "./types";

type ExistingMapMode = "editor" | "viewer";

function navigationError(
  message: string,
  code: string,
): MapPanelApiError {
  const error = new Error(message) as MapPanelApiError;
  error.code = code;
  error.status = 409;
  return error;
}

function resolveDestinationMode(
  context: MapPanelContextValue,
): ExistingMapMode {
  const mode =
    context.defaultPanel === "editor" ||
    context.defaultPanel === "viewer"
      ? context.defaultPanel
      : context.assignedMode === "editor" ||
          context.assignedMode === "viewer"
        ? context.assignedMode
        : null;

  if (!mode || !context.availablePanels[mode].allowed) {
    throw navigationError(
      "Este projeto não possui um painel de mapa disponível.",
      "PROJECT_MAP_ROUTE_NOT_ASSIGNED",
    );
  }

  return mode;
}

export async function prepareProjectMapDestination(
  projectSlug: string,
  signal?: AbortSignal,
) {
  const managementContext = await fetchProjectMapNavigation(
    projectSlug,
    "manage",
    signal,
  );
  const mode = resolveDestinationMode(managementContext);
  const pathname =
    `/projects/${encodeURIComponent(projectSlug)}/${mode === "editor" ? "edit" : "view"}`;

  const context = await fetchProjectMapNavigation(
    projectSlug,
    mode,
    signal,
  );

  if (
    context.allowed !== true ||
    context.mode !== mode ||
    context.project?.slug !== projectSlug
  ) {
    throw navigationError(
      "O contexto final do mapa não corresponde ao destino preparado.",
      "MAP_CONTEXT_HANDOFF_MISMATCH",
    );
  }

  primeMapPanelContextHandoff({
    pathname,
    context,
  });

  return {
    pathname,
    mode,
    context,
  };
}
