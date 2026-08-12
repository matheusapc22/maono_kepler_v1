import {
  clearActiveMapLoadTrace,
  getActiveMapLoadTrace,
  startMapLoadTrace,
  type MapLoadTrace,
  type MapLoadTraceError,
} from "./map-load-trace";

const OBSERVABILITY_ENDPOINT = "/api/observability/map-load";
const CANONICAL_PROJECT_MAP_ROUTE = /^\/projects\/([^/]+)\/(view|edit)\/?$/;
const RUNTIME_EVENT = "maono:map-runtime";
const TRACE_EVENT = "maono:map-load-event";
const TRACE_TERMINAL_EVENT = "maono:map-load-terminal";

let installed = false;
let routeKey: string | null = null;
let originalFetch: typeof window.fetch | null = null;
let sessionTimer: number | null = null;
let mapReadyFallbackTimer: number | null = null;
let pendingNavigationFailureTimer: number | null = null;
let runtimeRenderedAfterHydration = false;
let allowReadyWithoutShell = false;

function retryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function currentProjectRoute() {
  if (typeof window === "undefined") return null;
  const match = window.location.pathname.match(CANONICAL_PROJECT_MAP_ROUTE);
  if (!match) return null;

  return {
    key: `${decodeURIComponent(match[1])}:${match[2]}`,
    projectSlug: decodeURIComponent(match[1]),
    mode: match[2],
  };
}

function traceIsCurrent(trace: MapLoadTrace | null) {
  return Boolean(trace && getActiveMapLoadTrace() === trace && !trace.isFlushed());
}

function clearTimers() {
  if (sessionTimer !== null) window.clearTimeout(sessionTimer);
  if (mapReadyFallbackTimer !== null) window.clearTimeout(mapReadyFallbackTimer);
  if (pendingNavigationFailureTimer !== null) {
    window.clearTimeout(pendingNavigationFailureTimer);
  }
  sessionTimer = null;
  mapReadyFallbackTimer = null;
  pendingNavigationFailureTimer = null;
}

function sessionIsPublished() {
  const session = window.__MAONO_SESSION__;
  return Boolean(session && typeof session.authenticated === "boolean");
}

function ensureSessionResolved(trace: MapLoadTrace) {
  if (!traceIsCurrent(trace)) return false;
  if (trace.has("SESSION_RESOLVED")) return true;
  return trace.record("SESSION_RESOLVED");
}

function scheduleSessionResolution(trace: MapLoadTrace, attempts = 0) {
  if (!traceIsCurrent(trace) || trace.has("SESSION_RESOLVED")) return;
  if (sessionIsPublished()) {
    ensureSessionResolved(trace);
    return;
  }
  if (attempts >= 80) return;

  sessionTimer = window.setTimeout(() => {
    scheduleSessionResolution(trace, attempts + 1);
  }, 25);
}

function safeErrorFromEnvelope(
  data: any,
  fallbackStage: MapLoadTraceError["stage"],
): MapLoadTraceError {
  return {
    stage: fallbackStage,
    code: typeof data?.error?.code === "string" ? data.error.code : null,
    category:
      typeof data?.error?.category === "string" ? data.error.category : null,
    retryable:
      typeof data?.error?.retryable === "boolean" ? data.error.retryable : null,
    status: null,
  };
}

function navigationContext(data: any) {
  return data?.navigation || data?.context || data;
}

function projectContextFromNavigation(data: any) {
  const context = navigationContext(data);
  const project = context?.project;
  return {
    projectId: project?.id ?? null,
    revision:
      Number.isFinite(Number(project?.configRevision))
        ? Number(project.configRevision)
        : Number.isFinite(Number(context?.version))
          ? Number(context.version)
          : null,
  };
}

async function observeNavigationResponse(
  response: Response,
  trace: MapLoadTrace,
) {
  if (!traceIsCurrent(trace)) return;

  let data: any = null;
  try {
    data = await response.clone().json();
  } catch {
    data = null;
  }

  if (!traceIsCurrent(trace)) return;

  if (response.ok && data?.ok) {
    if (pendingNavigationFailureTimer !== null) {
      window.clearTimeout(pendingNavigationFailureTimer);
      pendingNavigationFailureTimer = null;
    }
    ensureSessionResolved(trace);
    const context = projectContextFromNavigation(data);
    trace.updateContext(context);
    trace.record("PROJECT_RESOLVED", context);
    trace.record("LOAD_GUARD_STARTED", context);
    return;
  }

  const fail = () => {
    if (!traceIsCurrent(trace) || trace.has("PROJECT_RESOLVED")) return;
    const error = safeErrorFromEnvelope(data, "PROJECT_RESOLVED");
    error.status = response.status;
    trace.fail(error);
    window.dispatchEvent(
      new CustomEvent(TRACE_TERMINAL_EVENT, {
        detail: { status: "error", correlationId: trace.correlationId },
      }),
    );
  };

  if (!retryableStatus(response.status)) {
    fail();
    return;
  }

  if (pendingNavigationFailureTimer !== null) {
    window.clearTimeout(pendingNavigationFailureTimer);
  }
  pendingNavigationFailureTimer = window.setTimeout(fail, 1600);
}

function requestUrl(input: RequestInfo | URL) {
  const raw = input instanceof Request ? input.url : String(input);
  try {
    return new URL(raw, window.location.origin);
  } catch {
    return null;
  }
}

function correlatedRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  correlationId: string,
): [RequestInfo | URL, RequestInit | undefined] {
  if (input instanceof Request) {
    const headers = new Headers(input.headers);
    new Headers(init?.headers || {}).forEach((value, key) => headers.set(key, value));
    headers.set("X-Correlation-Id", correlationId);
    return [
      new Request(input, {
        ...init,
        headers,
      }),
      undefined,
    ];
  }

  const headers = new Headers(init?.headers || {});
  headers.set("X-Correlation-Id", correlationId);
  return [input, { ...init, headers }];
}

async function flushTrace(trace: MapLoadTrace, preferBeacon = false) {
  if (!traceIsCurrent(trace)) return;
  const payload = trace.toPayload();
  trace.markFlushed();
  const body = JSON.stringify(payload);

  if (
    preferBeacon &&
    typeof navigator !== "undefined" &&
    typeof navigator.sendBeacon === "function"
  ) {
    try {
      const sent = navigator.sendBeacon(
        OBSERVABILITY_ENDPOINT,
        new Blob([body], { type: "application/json" }),
      );
      if (sent) return;
    } catch {
      // Telemetria nunca bloqueia a navegação do usuário.
    }
  }

  try {
    await originalFetch?.(OBSERVABILITY_ENDPOINT, {
      method: "POST",
      credentials: "include",
      keepalive: true,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Correlation-Id": trace.correlationId,
      },
      body,
    });
  } catch {
    // Observabilidade é best-effort e não altera o fluxo do mapa.
  }
}

function resetRuntimeReadiness() {
  runtimeRenderedAfterHydration = false;
  allowReadyWithoutShell = false;
  if (mapReadyFallbackTimer !== null) {
    window.clearTimeout(mapReadyFallbackTimer);
    mapReadyFallbackTimer = null;
  }
}

function tryMarkMapReady() {
  const trace = getActiveMapLoadTrace();
  if (!traceIsCurrent(trace) || !trace) return;
  if (trace.nextExpectedEvent() !== "MAP_READY") return;
  if (!runtimeRenderedAfterHydration) return;

  const shell = document.querySelector<HTMLElement>(".maono-map-runtime");
  if (shell) {
    const engineReady = shell.dataset.mapReady === "true";
    const engineLoading = shell.dataset.mapLoading === "true";
    if (!engineReady || engineLoading) return;
  } else if (!allowReadyWithoutShell) {
    if (mapReadyFallbackTimer === null) {
      mapReadyFallbackTimer = window.setTimeout(() => {
        mapReadyFallbackTimer = null;
        allowReadyWithoutShell = true;
        tryMarkMapReady();
      }, 80);
    }
    return;
  }

  if (trace.record("MAP_READY")) {
    void flushTrace(trace);
  }
}

function startTraceForCurrentRoute() {
  const route = currentProjectRoute();
  if (!route) {
    const previous = getActiveMapLoadTrace();
    if (previous && !previous.isFlushed()) void flushTrace(previous);
    routeKey = null;
    clearActiveMapLoadTrace(previous);
    resetRuntimeReadiness();
    return;
  }

  if (route.key === routeKey && getActiveMapLoadTrace()) return;

  const previous = getActiveMapLoadTrace();
  if (previous && !previous.isFlushed()) void flushTrace(previous);
  clearTimers();
  resetRuntimeReadiness();
  routeKey = route.key;
  const trace = startMapLoadTrace();
  scheduleSessionResolution(trace);
}

function installHistoryObserver() {
  const notify = () => window.queueMicrotask(startTraceForCurrentRoute);
  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);

  window.history.pushState = function patchedPushState(...args) {
    const result = originalPushState(...args);
    notify();
    return result;
  };
  window.history.replaceState = function patchedReplaceState(...args) {
    const result = originalReplaceState(...args);
    notify();
    return result;
  };
  window.addEventListener("popstate", notify);
}

function installFetchObserver() {
  originalFetch = window.fetch.bind(window);

  window.fetch = async function observedFetch(input, init) {
    const trace = getActiveMapLoadTrace();
    const url = requestUrl(input);
    const pathname = url?.pathname || "";
    const isSession = pathname === "/api/session";
    const isNavigation = /^\/api\/projects\/[^/]+\/map-navigation$/.test(pathname);
    const isConfig = /^\/api\/projects\/[^/]+\/config$/.test(pathname);

    let requestInput = input;
    let requestInit = init;
    if (traceIsCurrent(trace) && trace && (isNavigation || isConfig)) {
      [requestInput, requestInit] = correlatedRequest(
        input,
        init,
        trace.correlationId,
      );
      if (isConfig) trace.record("CONFIG_REQUESTED");
    }

    const response = await originalFetch!(requestInput, requestInit);

    if (traceIsCurrent(trace) && trace) {
      if (isSession && (response.ok || response.status === 401)) {
        scheduleSessionResolution(trace);
      } else if (isNavigation) {
        await observeNavigationResponse(response, trace);
      }
    }

    return response;
  };
}

function installRuntimeObserver() {
  window.addEventListener(RUNTIME_EVENT, (event) => {
    const detail = (event as CustomEvent<any>).detail;
    const trace = getActiveMapLoadTrace();
    if (!traceIsCurrent(trace) || !trace) return;
    if (!trace.has("ENGINE_HYDRATION_STARTED")) return;

    if (detail?.phase === "map-render" && detail?.styleLoaded === true) {
      runtimeRenderedAfterHydration = true;
      tryMarkMapReady();
    }
  });

  window.addEventListener(TRACE_EVENT, (event) => {
    const detail = (event as CustomEvent<any>).detail;
    if (detail?.event === "ENGINE_HYDRATION_STARTED") {
      runtimeRenderedAfterHydration = false;
      allowReadyWithoutShell = false;
    }
  });

  window.addEventListener(TRACE_TERMINAL_EVENT, () => {
    const trace = getActiveMapLoadTrace();
    if (trace && !trace.isFlushed()) void flushTrace(trace);
  });

  const observer = new MutationObserver(() => tryMarkMapReady());
  observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
    attributeFilter: ["data-map-ready", "data-map-loading"],
  });

  window.addEventListener("pagehide", () => {
    const trace = getActiveMapLoadTrace();
    if (trace && !trace.isFlushed()) void flushTrace(trace, true);
  });
}

export function installMapLoadObservability() {
  if (typeof window === "undefined" || installed) return;
  installed = true;
  installFetchObserver();
  installHistoryObserver();
  installRuntimeObserver();
  startTraceForCurrentRoute();
}
