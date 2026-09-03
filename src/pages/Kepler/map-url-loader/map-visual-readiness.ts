import {
  collectionToArray,
  readValue,
  selectKeplerVisState,
} from "../engine-adapter/selectors.ts";

export type MapVisualReadinessPhase =
  | "waiting-layers"
  | "waiting-datasets"
  | "waiting-runtime"
  | "waiting-render"
  | "ready";

type StoreLike = {
  getState: () => unknown;
  subscribe: (listener: () => void) => () => void;
};

type MapRuntimeLike = {
  isStyleLoaded?: () => boolean;
  triggerRepaint?: () => void;
};

type DeckRuntimeLike = {
  redraw?: (reason?: string | boolean) => void;
};

export type MapHydrationSnapshot = {
  phase: MapVisualReadinessPhase;
  ready: boolean;
  missingLayerIds: string[];
  missingDatasetIds: string[];
};

export type MapVisualReadinessResult = MapHydrationSnapshot & {
  durationMs: number;
  renderGeneration: number;
};

export type MapVisualReadinessError = Error & {
  code: "MAP_VISUAL_READY_TIMEOUT";
  category: "MAP_RUNTIME";
  retryable: true;
  phase: MapVisualReadinessPhase;
  missingLayerIds: string[];
  missingDatasetIds: string[];
};

const DEFAULT_VISUAL_READY_TIMEOUT_MS = 45_000;

let currentMapRuntime: MapRuntimeLike | null = null;
let currentDeckRuntime: DeckRuntimeLike | null = null;
let mapRenderGeneration = 0;
let lastMapRenderStyleLoaded = false;
let pendingVisualReadiness = 0;

const mapRuntimeListeners = new Set<() => void>();
const deckRuntimeListeners = new Set<() => void>();
const mapRenderListeners = new Set<() => void>();

function uniqueIds(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
}

function objectValues(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value;

  const valueSeq = (value as { valueSeq?: () => { toArray?: () => unknown[] } })
    .valueSeq?.();
  if (typeof valueSeq?.toArray === "function") {
    return valueSeq.toArray();
  }

  const toArray = (value as { toArray?: () => unknown[] }).toArray;
  if (typeof toArray === "function") {
    return toArray.call(value);
  }

  if (value instanceof Map) return Array.from(value.values());
  return Object.values(value as Record<string, unknown>);
}

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];

  const keySeq = (value as { keySeq?: () => { toArray?: () => unknown[] } })
    .keySeq?.();
  if (typeof keySeq?.toArray === "function") {
    return uniqueIds(keySeq.toArray());
  }

  if (value instanceof Map) return uniqueIds(Array.from(value.keys()));
  if (Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>);
}

function layerId(layer: unknown) {
  return String(readValue(layer, "id") ?? "").trim();
}

function datasetId(dataset: unknown) {
  const info = readValue(dataset, "info");
  const candidates = [
    readValue(dataset, "id"),
    readValue(info, "id"),
    readValue(readValue(dataset, "data"), "id"),
  ];

  for (const candidate of candidates) {
    const normalized = String(candidate ?? "").trim();
    if (normalized) return normalized;
  }

  return "";
}

export function expectedLayerIdsFromRuntimeConfig(config: unknown) {
  const visState = readValue(config, "visState");
  return uniqueIds(
    collectionToArray<unknown>(readValue(visState, "layers")).map(layerId),
  );
}

export function expectedDatasetIdsFromRuntimeDatasets(datasets: unknown) {
  return uniqueIds(objectValues(datasets).map(datasetId));
}

function hydratedLayerIds(rootState: unknown) {
  const visState = selectKeplerVisState(rootState);
  return new Set(
    uniqueIds(
      collectionToArray<unknown>(readValue(visState, "layers")).map(layerId),
    ),
  );
}

function hydratedDatasetIds(rootState: unknown) {
  const visState = selectKeplerVisState(rootState);
  const datasets = readValue(visState, "datasets");
  return new Set(
    uniqueIds([
      ...objectKeys(datasets),
      ...objectValues(datasets).map(datasetId),
    ]),
  );
}

export function inspectMapHydrationState(
  rootState: unknown,
  expectedLayerIds: string[],
  expectedDatasetIds: string[],
): MapHydrationSnapshot {
  const layerIds = hydratedLayerIds(rootState);
  const datasetIds = hydratedDatasetIds(rootState);
  const missingLayerIds = expectedLayerIds.filter((id) => !layerIds.has(id));
  const missingDatasetIds = expectedDatasetIds.filter(
    (id) => !datasetIds.has(id),
  );

  if (missingDatasetIds.length) {
    return {
      phase: "waiting-datasets",
      ready: false,
      missingLayerIds,
      missingDatasetIds,
    };
  }

  if (missingLayerIds.length) {
    return {
      phase: "waiting-layers",
      ready: false,
      missingLayerIds,
      missingDatasetIds,
    };
  }

  return {
    phase: "waiting-runtime",
    ready: true,
    missingLayerIds: [],
    missingDatasetIds: [],
  };
}

export function registerMaonoMapRuntime(value: unknown) {
  currentMapRuntime =
    value && typeof value === "object" ? (value as MapRuntimeLike) : null;
  mapRuntimeListeners.forEach((listener) => listener());
}

export function registerMaonoDeckRuntime(value: unknown) {
  currentDeckRuntime =
    value && typeof value === "object" ? (value as DeckRuntimeLike) : null;
  deckRuntimeListeners.forEach((listener) => listener());
}

export function resetMaonoMapVisualReadinessRuntime() {
  currentMapRuntime = null;
  currentDeckRuntime = null;
  lastMapRenderStyleLoaded = false;
  mapRuntimeListeners.forEach((listener) => listener());
  deckRuntimeListeners.forEach((listener) => listener());
}

export function getMaonoMapVisualReadinessDiagnostics() {
  return {
    mapRuntimeAttached: Boolean(currentMapRuntime),
    deckRuntimeAttached: Boolean(currentDeckRuntime),
    pendingVisualReadiness,
    mapRuntimeListenerCount: mapRuntimeListeners.size,
    deckRuntimeListenerCount: deckRuntimeListeners.size,
    mapRenderListenerCount: mapRenderListeners.size,
    mapRenderGeneration,
  };
}

export function notifyMaonoMapRender({
  styleLoaded,
}: {
  styleLoaded: boolean;
}) {
  mapRenderGeneration += 1;
  lastMapRenderStyleLoaded = styleLoaded;
  mapRenderListeners.forEach((listener) => listener());
}

export function isMaonoMapVisualReadinessPending() {
  return pendingVisualReadiness > 0;
}

function abortError() {
  return new DOMException("Aborted", "AbortError");
}

function waitForHydration(
  store: StoreLike,
  expectedLayerIds: string[],
  expectedDatasetIds: string[],
  signal: AbortSignal,
  onSnapshot: (snapshot: MapHydrationSnapshot) => void,
) {
  return new Promise<MapHydrationSnapshot>((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;

    const cleanup = () => {
      unsubscribe();
      signal.removeEventListener("abort", handleAbort);
    };
    const handleAbort = () => {
      cleanup();
      reject(abortError());
    };
    const check = () => {
      const snapshot = inspectMapHydrationState(
        store.getState(),
        expectedLayerIds,
        expectedDatasetIds,
      );
      onSnapshot(snapshot);
      if (!snapshot.ready) return;
      cleanup();
      resolve(snapshot);
    };

    if (signal.aborted) {
      reject(abortError());
      return;
    }

    unsubscribe = store.subscribe(check);
    signal.addEventListener("abort", handleAbort, { once: true });
    check();
  });
}

function waitForRuntime(
  signal: AbortSignal,
  requireDeckRuntime: boolean,
) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      mapRuntimeListeners.delete(check);
      deckRuntimeListeners.delete(check);
      signal.removeEventListener("abort", handleAbort);
    };
    const handleAbort = () => {
      cleanup();
      reject(abortError());
    };
    const check = () => {
      if (!currentMapRuntime) return;
      if (requireDeckRuntime && !currentDeckRuntime) return;
      cleanup();
      resolve();
    };

    if (signal.aborted) {
      reject(abortError());
      return;
    }

    mapRuntimeListeners.add(check);
    deckRuntimeListeners.add(check);
    signal.addEventListener("abort", handleAbort, { once: true });
    check();
  });
}

function waitForNextStyleRender(
  baselineGeneration: number,
  signal: AbortSignal,
) {
  return new Promise<number>((resolve, reject) => {
    const cleanup = () => {
      mapRenderListeners.delete(check);
      signal.removeEventListener("abort", handleAbort);
    };
    const handleAbort = () => {
      cleanup();
      reject(abortError());
    };
    const check = () => {
      if (mapRenderGeneration <= baselineGeneration) return;
      if (!lastMapRenderStyleLoaded) return;
      cleanup();
      resolve(mapRenderGeneration);
    };

    if (signal.aborted) {
      reject(abortError());
      return;
    }

    mapRenderListeners.add(check);
    signal.addEventListener("abort", handleAbort, { once: true });
    check();
  });
}

function nextAnimationFrame(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    });
    const handleAbort = () => {
      window.cancelAnimationFrame(frameId);
      signal.removeEventListener("abort", handleAbort);
      reject(abortError());
    };

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function createTimeoutError(snapshot: MapHydrationSnapshot) {
  const detail = [
    snapshot.missingLayerIds.length
      ? `camadas pendentes: ${snapshot.missingLayerIds.join(", ")}`
      : "",
    snapshot.missingDatasetIds.length
      ? `datasets pendentes: ${snapshot.missingDatasetIds.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("; ");
  const error = new Error(
    detail
      ? `O mapa não concluiu a preparação visual. ${detail}.`
      : "O mapa recebeu os dados, mas não concluiu a primeira renderização das camadas.",
  ) as MapVisualReadinessError;

  error.name = "MapVisualReadinessError";
  error.code = "MAP_VISUAL_READY_TIMEOUT";
  error.category = "MAP_RUNTIME";
  error.retryable = true;
  error.phase = snapshot.phase;
  error.missingLayerIds = [...snapshot.missingLayerIds];
  error.missingDatasetIds = [...snapshot.missingDatasetIds];
  return error;
}

export function isMapVisualReadinessError(
  value: unknown,
): value is MapVisualReadinessError {
  return Boolean(
    value instanceof Error &&
      (value as Partial<MapVisualReadinessError>).code ===
        "MAP_VISUAL_READY_TIMEOUT",
  );
}

export async function waitForMaonoMapVisualReadiness({
  store,
  expectedLayerIds,
  expectedDatasetIds,
  signal,
  timeoutMs = DEFAULT_VISUAL_READY_TIMEOUT_MS,
}: {
  store: StoreLike;
  expectedLayerIds: string[];
  expectedDatasetIds: string[];
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<MapVisualReadinessResult> {
  const startedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  const controller = new AbortController();
  let timedOut = false;
  let latestSnapshot = inspectMapHydrationState(
    store.getState(),
    expectedLayerIds,
    expectedDatasetIds,
  );

  const handleParentAbort = () => controller.abort();
  signal.addEventListener("abort", handleParentAbort, { once: true });
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  pendingVisualReadiness += 1;

  try {
    await waitForHydration(
      store,
      expectedLayerIds,
      expectedDatasetIds,
      controller.signal,
      (snapshot) => {
        latestSnapshot = snapshot;
      },
    );

    latestSnapshot = {
      phase: "waiting-runtime",
      ready: true,
      missingLayerIds: [],
      missingDatasetIds: [],
    };

    await waitForRuntime(
      controller.signal,
      expectedLayerIds.length > 0,
    );

    // A Redux hydration is synchronous, but the connected Kepler/Deck tree still
    // needs a browser turn to consume the new layer objects. This frame is the
    // hand-off between "state ready" and "runtime ready".
    await nextAnimationFrame(controller.signal);

    latestSnapshot = {
      ...latestSnapshot,
      phase: "waiting-render",
    };

    const baselineGeneration = mapRenderGeneration;
    const renderPromise = waitForNextStyleRender(
      baselineGeneration,
      controller.signal,
    );

    // Force a post-hydration frame without changing viewport geometry. Deck's
    // redraw targets only its existing WebGL surface; MapLibre's repaint makes
    // the map-render boundary observable after the expected layers exist.
    currentDeckRuntime?.redraw?.("maono-visual-readiness");
    currentMapRuntime?.triggerRepaint?.();

    const renderGeneration = await renderPromise;

    // Keep the centralized overlay through the browser paint that follows the
    // post-hydration render. A second RAF prevents the overlay from disappearing
    // in the same frame in which the data layer was submitted to WebGL.
    currentDeckRuntime?.redraw?.("maono-visual-readiness-final");
    await nextAnimationFrame(controller.signal);
    await nextAnimationFrame(controller.signal);

    latestSnapshot = {
      phase: "ready",
      ready: true,
      missingLayerIds: [],
      missingDatasetIds: [],
    };

    const endedAt =
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();

    return {
      ...latestSnapshot,
      durationMs: Math.max(0, Math.round(endedAt - startedAt)),
      renderGeneration,
    };
  } catch (error) {
    if (timedOut) {
      throw createTimeoutError(latestSnapshot);
    }
    throw error;
  } finally {
    pendingVisualReadiness = Math.max(0, pendingVisualReadiness - 1);
    window.clearTimeout(timeoutId);
    signal.removeEventListener("abort", handleParentAbort);
  }
}
