import { EMPTY_MAP_CAPABILITIES, EMPTY_MAP_PANEL_FEATURES } from "./types";
import type {
  MapCapabilities,
  MapNavigationMode,
  MapPanelApiError,
  MapPanelAvailability,
  MapPanelContextValue,
  MapPanelFeatures,
  MapRuntimeMode,
  ResourceLimit,
  SafeMapOrganization,
  SafeMapProject,
} from "./types";

const MAP_CONTEXT_RETRY_DELAYS_MS = [250, 700];

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidContext(
  message = "A API retornou um contexto de mapa inválido.",
): MapPanelApiError {
  const error = new Error(message) as MapPanelApiError;
  error.status = 502;
  error.code = "INVALID_MAP_PANEL_CONTEXT";
  return error;
}

function isRuntimeMode(value: unknown): value is MapRuntimeMode {
  return value === "viewer" || value === "editor" || value === "create";
}

function isNavigationMode(value: unknown): value is MapNavigationMode {
  return value === "manage" || isRuntimeMode(value);
}

function normalizeAvailability(
  value: unknown,
  fallbackRoute: string | null,
): MapPanelAvailability {
  if (isRecord(value)) {
    const allowed = value.allowed === true;
    const route =
      allowed && typeof value.route === "string" && value.route.trim()
        ? value.route
        : allowed
          ? fallbackRoute
          : null;

    return {
      allowed,
      route,
      reason: allowed
        ? null
        : typeof value.reason === "string" && value.reason.trim()
          ? value.reason
          : "PANEL_NOT_AVAILABLE",
    };
  }

  const allowed = value === true;

  return {
    allowed,
    route: allowed ? fallbackRoute : null,
    reason: allowed ? null : "PANEL_NOT_AVAILABLE",
  };
}

function normalizeBooleanContract<T extends Record<string, boolean>>(
  emptyContract: T,
  value: unknown,
): T {
  const source = isRecord(value) ? value : {};
  const normalized = {} as T;

  for (const key of Object.keys(emptyContract) as Array<keyof T>) {
    normalized[key] = (source[String(key)] === true) as T[keyof T];
  }

  return normalized;
}

function normalizeProject(value: unknown): SafeMapProject | null {
  if (!isRecord(value)) return null;

  const id = value.id;
  const slug = typeof value.slug === "string" ? value.slug.trim() : "";
  const name = typeof value.name === "string" ? value.name : "";

  if ((typeof id !== "number" && typeof id !== "string") || !slug || !name) {
    throw invalidContext("O projeto retornado pela API é inválido.");
  }

  return {
    id,
    slug,
    name,
    description:
      typeof value.description === "string" || value.description === null
        ? value.description
        : undefined,
    accessLevel:
      typeof value.accessLevel === "string" || value.accessLevel === null
        ? value.accessLevel
        : undefined,
    configRevision: Number.isFinite(Number(value.configRevision))
      ? Number(value.configRevision)
      : undefined,
  };
}

function normalizeOrganization(value: unknown): SafeMapOrganization | null {
  if (!isRecord(value)) return null;

  const id = value.id;

  if (typeof id !== "number" && typeof id !== "string") {
    throw invalidContext("A organização retornada pela API é inválida.");
  }

  return {
    id,
    name: typeof value.name === "string" ? value.name : undefined,
    slug: typeof value.slug === "string" ? value.slug : undefined,
  };
}

function normalizeResourceLimit(value: unknown): ResourceLimit | null {
  if (!isRecord(value)) return null;

  const used = Number(value.used);
  const limit = Number(value.limit);
  const remaining = Number(value.remaining);

  if (
    !Number.isFinite(used) ||
    !Number.isFinite(limit) ||
    !Number.isFinite(remaining)
  ) {
    return null;
  }

  return {
    used,
    reserved: Number.isFinite(Number(value.reserved))
      ? Number(value.reserved)
      : undefined,
    limit,
    remaining,
    ready: typeof value.ready === "boolean" ? value.ready : undefined,
    status: typeof value.status === "string" ? value.status : undefined,
  };
}

function assertCapabilityContract(
  mode: MapRuntimeMode,
  capabilities: MapCapabilities,
  project: SafeMapProject | null,
) {
  const valid =
    mode === "viewer"
      ? capabilities.viewMap
      : mode === "editor"
        ? capabilities.viewMap &&
          capabilities.editLayers &&
          capabilities.saveMap
        : project
          ? capabilities.viewMap &&
            capabilities.editLayers &&
            capabilities.openCreateWorkspace &&
            capabilities.saveMap
          : capabilities.openCreateWorkspace &&
            capabilities.createProject &&
            capabilities.initializeMap &&
            capabilities.saveMap;

  if (!valid) {
    throw invalidContext(
      `O contexto ${mode} não contém as capacidades obrigatórias.`,
    );
  }
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

function retryableMapContextStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function waitForMapContextRetry(
  milliseconds: number,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);

    function handleAbort() {
      globalThis.clearTimeout(timeoutId);
      reject(new DOMException("Aborted", "AbortError"));
    }

    signal?.addEventListener("abort", handleAbort, { once: true });
  });
}

async function requestMapContextResponse(
  url: string,
  signal?: AbortSignal,
) {
  const totalAttempts = MAP_CONTEXT_RETRY_DELAYS_MS.length + 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
        signal,
      });

      let data: any;
      try {
        data = await readJson(response);
      } catch (error) {
        lastError = error;
        if (
          retryableMapContextStatus(response.status) &&
          attempt < MAP_CONTEXT_RETRY_DELAYS_MS.length
        ) {
          await waitForMapContextRetry(
            MAP_CONTEXT_RETRY_DELAYS_MS[attempt],
            signal,
          );
          continue;
        }
        throw error;
      }

      if (
        retryableMapContextStatus(response.status) &&
        attempt < MAP_CONTEXT_RETRY_DELAYS_MS.length
      ) {
        await waitForMapContextRetry(
          MAP_CONTEXT_RETRY_DELAYS_MS[attempt],
          signal,
        );
        continue;
      }

      return { response, data };
    } catch (error) {
      if (signal?.aborted) throw error;
      lastError = error;

      if (attempt >= MAP_CONTEXT_RETRY_DELAYS_MS.length) {
        throw error;
      }

      await waitForMapContextRetry(
        MAP_CONTEXT_RETRY_DELAYS_MS[attempt],
        signal,
      );
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Não foi possível resolver o painel deste mapa.");
}

async function requestMapContext(
  url: string,
  signal?: AbortSignal,
): Promise<MapPanelContextValue> {
  const { response, data } = await requestMapContextResponse(url, signal);

  if (!response.ok || !data?.ok) {
    const error = new Error(
      data?.error?.message || "Não foi possível resolver o painel deste mapa.",
    ) as MapPanelApiError;
    error.status = response.status;
    error.code = data?.error?.code || "MAP_PANEL_REQUEST_FAILED";
    error.details = data?.error?.details || null;
    throw error;
  }

  const context = data.navigation || data.context || data;

  if (!isRecord(context)) {
    const error = new Error(
      "O contexto do mapa não foi retornado.",
    ) as MapPanelApiError;
    error.status = 502;
    error.code = "MAP_PANEL_CONTEXT_MISSING";
    throw error;
  }

  if (!isRuntimeMode(context.mode)) {
    throw invalidContext("O modo efetivo do mapa é inválido.");
  }

  if (!isNavigationMode(context.requestedMode)) {
    throw invalidContext("O modo solicitado do mapa é inválido.");
  }

  const policyVersion = Number(context.policyVersion);

  if (!Number.isInteger(policyVersion) || policyVersion < 1) {
    throw invalidContext("A versão da política do mapa é inválida.");
  }

  const project = normalizeProject(context.project);
  const organization = normalizeOrganization(context.organization);
  const projectSlug = project?.slug;
  const availablePanels = {
    viewer: normalizeAvailability(
      context.availablePanels?.viewer,
      projectSlug ? `/projects/${encodeURIComponent(projectSlug)}/view` : null,
    ),
    editor: normalizeAvailability(
      context.availablePanels?.editor,
      projectSlug ? `/projects/${encodeURIComponent(projectSlug)}/edit` : null,
    ),
    create: normalizeAvailability(
      context.availablePanels?.create,
      projectSlug
        ? `/projects/${encodeURIComponent(projectSlug)}/create`
        : "/maps/new/create",
    ),
  };
  const selectedAvailability = availablePanels[context.mode];
  const explicitlyBlocked = context.allowed === false;
  const allowed = !explicitlyBlocked && selectedAvailability.allowed;
  const capabilities = normalizeBooleanContract(
    EMPTY_MAP_CAPABILITIES,
    context.capabilities,
  ) as MapCapabilities;
  const features = normalizeBooleanContract(
    EMPTY_MAP_PANEL_FEATURES,
    context.features,
  ) as MapPanelFeatures;

  if (!explicitlyBlocked && !selectedAvailability.allowed) {
    throw invalidContext(
      "O painel resolvido não foi autorizado no contexto retornado.",
    );
  }

  if (allowed) {
    assertCapabilityContract(context.mode, capabilities, project);

    if (context.mode === "create" && !features.mapCreateRoute) {
      throw invalidContext(
        "A rota de criação não foi habilitada pelo backend.",
      );
    }

    if (context.mode === "create" && !organization) {
      throw invalidContext(
        "O contexto de criação não informou a organização ativa.",
      );
    }

    if (context.mode !== "create" && !project) {
      throw invalidContext(
        "O contexto do projeto não informou um projeto válido.",
      );
    }
  }

  const projectsLimit = normalizeResourceLimit(context.limits?.projects);
  const storageLimit = normalizeResourceLimit(context.limits?.storageMb);
  const maxConfigBytes = Number(context.constraints?.maxConfigBytes);
  const maxThumbnailBytes = Number(context.constraints?.maxThumbnailBytes);
  const defaultPanel =
    context.defaultPanel === null
      ? null
      : isRuntimeMode(context.defaultPanel)
        ? context.defaultPanel
        : null;

  return {
    policyVersion,
    mode: context.mode,
    requestedMode: context.requestedMode,
    defaultPanel,
    availablePanels,
    allowed,
    reason:
      typeof context.reason === "string" && context.reason.trim()
        ? context.reason
        : allowed
          ? null
          : selectedAvailability.reason,
    capabilities,
    project,
    organization,
    version: Number.isFinite(Number(context.version))
      ? Number(context.version)
      : undefined,
    limits:
      projectsLimit && storageLimit
        ? {
            projects: projectsLimit,
            storageMb: storageLimit,
          }
        : undefined,
    constraints:
      Number.isFinite(maxConfigBytes) &&
      maxConfigBytes > 0 &&
      Number.isFinite(maxThumbnailBytes) &&
      maxThumbnailBytes > 0
        ? {
            maxConfigBytes,
            maxThumbnailBytes,
            acceptedConfigContentTypes: Array.isArray(
              context.constraints?.acceptedConfigContentTypes,
            )
              ? context.constraints.acceptedConfigContentTypes.filter(
                  (value: unknown): value is string =>
                    typeof value === "string",
                )
              : undefined,
            acceptedThumbnailContentTypes: Array.isArray(
              context.constraints?.acceptedThumbnailContentTypes,
            )
              ? context.constraints.acceptedThumbnailContentTypes.filter(
                  (value: unknown): value is string =>
                    typeof value === "string",
                )
              : undefined,
          }
        : undefined,
    features,
  };
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
