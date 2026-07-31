type LayoutRect = {
  width: number;
  height: number;
  x: number;
  y: number;
  top: number;
  left: number;
  right: number;
  bottom: number;
};

export type ComparableLayoutRect = Pick<LayoutRect, "width" | "height" | "x" | "y">;

export function isLayoutGeometryInvariant(
  before: ComparableLayoutRect,
  after: ComparableLayoutRect,
  tolerance = 1,
) {
  return (["width", "height", "x", "y"] as const).every(
    (key) => Math.abs(after[key] - before[key]) <= tolerance,
  );
}

export type BasemapRuntimeCheck = {
  keplerMounted: boolean;
  mapWidth: number;
  mapHeight: number;
  canvasCount: number;
  validCanvasCount: number;
  mapLibraryMounted: boolean;
  styleLoaded: boolean;
  contextAvailable: boolean;
  coveredByBlockingElement: boolean;
};

export function basemapRuntimeFailures(check: BasemapRuntimeCheck) {
  const failures: string[] = [];
  if (!check.keplerMounted) failures.push("KEPLER_NOT_MOUNTED");
  if (check.mapWidth <= 0 || check.mapHeight <= 0) failures.push("MAP_COLLAPSED");
  if (!check.canvasCount) failures.push("CANVAS_MISSING");
  if (!check.validCanvasCount) failures.push("CANVAS_INVALID_SIZE");
  if (!check.mapLibraryMounted) failures.push("MAP_LIBRARY_MISSING");
  if (!check.styleLoaded) failures.push("STYLE_NOT_LOADED");
  if (!check.contextAvailable) failures.push("WEBGL_UNAVAILABLE");
  if (check.coveredByBlockingElement) failures.push("CANVAS_COVERED");
  return failures;
}

type LayoutEntry = {
  label: string;
  selector: string;
  index: number;
  exists: boolean;
  childElementCount: number;
  rect: LayoutRect | null;
  styles: Record<string, string>;
};

type CanvasEntry = {
  index: number;
  className: string;
  internalWidth: number;
  internalHeight: number;
  cssWidth: number;
  cssHeight: number;
  context: "webgl2" | "webgl" | "unavailable";
};

type RuntimeEvent = {
  phase: string;
  capturedAt: string;
  detail: Record<string, unknown>;
};

type LayoutSnapshot = {
  reason: string;
  capturedAt: string;
  viewport: {
    width: number;
    height: number;
    devicePixelRatio: number;
  };
  runtime: {
    mode: string | null;
    panelOpen: string | null;
    mapReady: string | null;
    mapLoading: string | null;
    basemapStyle: string | null;
    basemapVisible: string | null;
    mapStatePresent: string | null;
    mapStylePresent: string | null;
    viewport: string | null;
    stateKeys: string[];
  };
  entries: LayoutEntry[];
  canvases: CanvasEntry[];
  centerStack: string[];
  check: BasemapRuntimeCheck;
  failures: string[];
  runtimeEvents: RuntimeEvent[];
};

const TARGETS = [
  ["runtime", ".maono-map-runtime"],
  ["workspace", ".maono-map-runtime__workspace"],
  ["map-area", ".maono-map-runtime__map"],
  ["kepler-frame", ".maono-kepler-root"],
  ["screenshot-wrapper", ".maono-kepler-screenshot-root"],
  ["connected-app-root", ".maono-kepler-container"],
  ["panel-group", ".maono-kepler-panel-group"],
  ["panel", ".maono-kepler-main-panel, .maono-kepler-map-panel"],
  ["measured-viewport", ".maono-kepler-viewport"],
  ["kepler-root", ".kepler-gl"],
  ["map-container", ".map-container"],
  ["mapbox-map", ".mapboxgl-map"],
  ["mapbox-canvas-container", ".mapboxgl-canvas-container"],
  ["mapbox-canvas", ".mapboxgl-canvas"],
  ["maplibre-map", ".maplibregl-map"],
  ["maplibre-canvas-container", ".maplibregl-canvas-container"],
  ["maplibre-canvas", ".maplibregl-canvas"],
  ["deck-canvas", "#default-deckgl-overlay canvas, canvas.deck-canvas"],
  ["panel-host", ".maono-map-panel-host"],
  ["panel-backdrop", ".maono-map-panel-host__backdrop"],
  ["panel-content", ".maono-map-panel-host__panel"],
  ["layer-panel", ".maono-layer-panel"],
] as const;

const STYLE_KEYS = [
  "display",
  "visibility",
  "opacity",
  "position",
  "inset",
  "top",
  "right",
  "bottom",
  "left",
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "overflow",
  "overflowX",
  "overflowY",
  "zIndex",
  "transform",
  "pointerEvents",
  "background",
  "backgroundColor",
] as const;

function rounded(value: number) {
  return Math.round(value * 100) / 100;
}

function rectOf(element: Element): LayoutRect {
  const rect = element.getBoundingClientRect();
  return {
    width: rounded(rect.width),
    height: rounded(rect.height),
    x: rounded(rect.x),
    y: rounded(rect.y),
    top: rounded(rect.top),
    left: rounded(rect.left),
    right: rounded(rect.right),
    bottom: rounded(rect.bottom),
  };
}

function stylesOf(element: Element) {
  const computed = window.getComputedStyle(element);
  return Object.fromEntries(STYLE_KEYS.map((key) => [key, computed[key] || ""]));
}

function elementLabel(element: Element) {
  const classes = Array.from(element.classList).slice(0, 4).join(".");
  return `${element.tagName.toLocaleLowerCase()}${element.id ? `#${element.id}` : ""}${classes ? `.${classes}` : ""}`;
}

function webglContext(canvas: HTMLCanvasElement): CanvasEntry["context"] {
  try {
    if (canvas.getContext("webgl2")) return "webgl2";
    if (canvas.getContext("webgl")) return "webgl";
  } catch {
    return "unavailable";
  }
  return "unavailable";
}

function canvasEntries(): CanvasEntry[] {
  return Array.from(document.querySelectorAll("canvas")).map((canvas, index) => {
    const element = canvas as HTMLCanvasElement;
    const rect = element.getBoundingClientRect();
    return {
      index,
      className: element.className || "",
      internalWidth: element.width,
      internalHeight: element.height,
      cssWidth: rounded(rect.width),
      cssHeight: rounded(rect.height),
      context: webglContext(element),
    };
  });
}

function centerStack(mapArea: Element | null) {
  if (!mapArea || typeof document.elementsFromPoint !== "function") return [];
  const rect = mapArea.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return [];
  return document
    .elementsFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    .slice(0, 12)
    .map(elementLabel);
}

function isBlockingCenterElement(stack: string[]) {
  const first = stack[0] ?? "";
  if (!first) return false;
  return (
    first.includes("backdrop") ||
    first.includes("panel-host__panel") ||
    first.includes("loading")
  );
}

function captureEntries(): LayoutEntry[] {
  const entries: LayoutEntry[] = [];

  for (const [label, selector] of TARGETS) {
    const matches = Array.from(document.querySelectorAll(selector));
    if (!matches.length) {
      entries.push({
        label,
        selector,
        index: 0,
        exists: false,
        childElementCount: 0,
        rect: null,
        styles: {},
      });
      continue;
    }

    matches.forEach((element, index) => {
      entries.push({
        label,
        selector,
        index,
        exists: true,
        childElementCount: element.childElementCount,
        rect: rectOf(element),
        styles: stylesOf(element),
      });
    });
  }

  return entries;
}

function safeRuntimeDetail(detail: unknown): Record<string, unknown> {
  if (!detail || typeof detail !== "object") return {};
  const input = detail as Record<string, unknown>;
  const allowed = ["attached", "height", "layerCount", "message", "phase", "styleLoaded", "width"];
  return Object.fromEntries(allowed.filter((key) => key in input).map((key) => [key, input[key]]));
}

function captureLayout(reason: string, runtimeEvents: RuntimeEvent[]): LayoutSnapshot {
  const runtime = document.querySelector(".maono-map-runtime");
  const host = document.querySelector(".maono-map-panel-host");
  const mapArea = document.querySelector(".maono-map-runtime__map");
  const mapRect = mapArea?.getBoundingClientRect();
  const canvases = canvasEntries();
  const stack = centerStack(mapArea);
  const check: BasemapRuntimeCheck = {
    keplerMounted: Boolean(document.querySelector(".kepler-gl")),
    mapWidth: rounded(mapRect?.width ?? 0),
    mapHeight: rounded(mapRect?.height ?? 0),
    canvasCount: canvases.length,
    validCanvasCount: canvases.filter((canvas) =>
      canvas.internalWidth > 0 &&
      canvas.internalHeight > 0 &&
      canvas.cssWidth > 0 &&
      canvas.cssHeight > 0,
    ).length,
    mapLibraryMounted: Boolean(document.querySelector(".mapboxgl-map, .maplibregl-map")),
    styleLoaded: runtimeEvents.some(
      (event) =>
        event.phase === "style-loaded" ||
        ((event.phase === "map-ref" || event.phase === "map-render") &&
          event.detail.styleLoaded === true),
    ),
    contextAvailable: canvases.some((canvas) => canvas.context !== "unavailable"),
    coveredByBlockingElement: isBlockingCenterElement(stack),
  };

  return {
    reason,
    capturedAt: new Date().toISOString(),
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    runtime: {
      mode: runtime?.getAttribute("data-map-mode") ?? null,
      panelOpen: host?.getAttribute("data-panel-open") ?? null,
      mapReady: runtime?.getAttribute("data-map-ready") ?? null,
      mapLoading: runtime?.getAttribute("data-map-loading") ?? null,
      basemapStyle: runtime?.getAttribute("data-basemap-style") ?? null,
      basemapVisible: runtime?.getAttribute("data-basemap-visible") ?? null,
      mapStatePresent: runtime?.getAttribute("data-map-state-present") ?? null,
      mapStylePresent: runtime?.getAttribute("data-map-style-present") ?? null,
      viewport: runtime?.getAttribute("data-map-viewport") ?? null,
      stateKeys: String(runtime?.getAttribute("data-engine-state-keys") ?? "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean),
    },
    entries: captureEntries(),
    canvases,
    centerStack: stack,
    check,
    failures: basemapRuntimeFailures(check),
    runtimeEvents: [...runtimeEvents],
  };
}

function comparisonRows(before: LayoutSnapshot, after: LayoutSnapshot) {
  const beforeByKey = new Map(before.entries.map((entry) => [`${entry.label}:${entry.index}`, entry]));
  return after.entries.map((entry) => {
    const previous = beforeByKey.get(`${entry.label}:${entry.index}`);
    return {
      node: `${entry.label}[${entry.index}]`,
      exists: entry.exists,
      beforeWidth: previous?.rect?.width ?? null,
      afterWidth: entry.rect?.width ?? null,
      deltaWidth:
        previous?.rect && entry.rect
          ? rounded(entry.rect.width - previous.rect.width)
          : null,
      beforeHeight: previous?.rect?.height ?? null,
      afterHeight: entry.rect?.height ?? null,
      deltaHeight:
        previous?.rect && entry.rect
          ? rounded(entry.rect.height - previous.rect.height)
          : null,
    };
  });
}

function debugEnabled() {
  try {
    return (
      new URLSearchParams(window.location.search).get("maonoLayoutDebug") === "1" ||
      window.localStorage.getItem("maono:layout-debug") === "1"
    );
  } catch {
    return false;
  }
}

export function installMaonoMapLayoutDebug() {
  if (typeof window === "undefined" || !debugEnabled()) return undefined;

  const runtime = document.querySelector(".maono-map-runtime");
  if (!runtime) {
    console.warn("[Maõno map debug] .maono-map-runtime não foi encontrado.");
    return undefined;
  }

  const runtimeEvents: RuntimeEvent[] = [];
  const history: LayoutSnapshot[] = [];
  let previous = captureLayout("initial", runtimeEvents);
  history.push(previous);
  let frameOne = 0;
  let frameTwo = 0;

  const publish = (reason: string) => {
    const next = captureLayout(reason, runtimeEvents);
    history.push(next);
    console.groupCollapsed(`[Maõno map debug] ${reason}`);
    console.table(comparisonRows(previous, next));
    console.table(next.canvases);
    console.log("runtime", next.runtime);
    console.log("centerStack", next.centerStack);
    console.log("failures", next.failures);
    console.log("snapshot", next);
    console.groupEnd();
    previous = next;
    return next;
  };

  const handleRuntimeEvent = (event: Event) => {
    const custom = event as CustomEvent<Record<string, unknown>>;
    const detail = safeRuntimeDetail(custom.detail);
    runtimeEvents.push({
      phase: String(detail.phase ?? "unknown"),
      capturedAt: new Date().toISOString(),
      detail,
    });
    if (detail.phase === "style-loaded" || detail.phase === "map-error") {
      publish(String(detail.phase));
    }
  };

  const handleWebglLost = (event: Event) => {
    runtimeEvents.push({phase: "webgl-context-lost", capturedAt: new Date().toISOString(), detail: {prevented: event.defaultPrevented}});
    publish("webgl-context-lost");
  };

  const handleWebglRestored = () => {
    runtimeEvents.push({phase: "webgl-context-restored", capturedAt: new Date().toISOString(), detail: {}});
    publish("webgl-context-restored");
  };

  window.addEventListener("maono:map-runtime", handleRuntimeEvent);
  document.addEventListener("webglcontextlost", handleWebglLost, true);
  document.addEventListener("webglcontextrestored", handleWebglRestored, true);

  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => mutation.type === "attributes" && mutation.attributeName === "data-panel-open")) return;
    window.cancelAnimationFrame(frameOne);
    window.cancelAnimationFrame(frameTwo);
    frameOne = window.requestAnimationFrame(() => {
      frameTwo = window.requestAnimationFrame(() => publish("panel-state-changed"));
    });
  });

  observer.observe(runtime, {attributes: true, subtree: true, attributeFilter: ["data-panel-open"]});

  const debugApi = {
    capture: (reason = "manual") => publish(reason),
    history,
    runtimeEvents,
  };
  (window as Window & {__MAONO_MAP_LAYOUT_DEBUG__?: typeof debugApi}).__MAONO_MAP_LAYOUT_DEBUG__ = debugApi;

  console.info("[Maõno map debug] ativo. Use window.__MAONO_MAP_LAYOUT_DEBUG__.capture('manual').");
  console.log("[Maõno map debug] initial", previous);

  return () => {
    observer.disconnect();
    window.removeEventListener("maono:map-runtime", handleRuntimeEvent);
    document.removeEventListener("webglcontextlost", handleWebglLost, true);
    document.removeEventListener("webglcontextrestored", handleWebglRestored, true);
    window.cancelAnimationFrame(frameOne);
    window.cancelAnimationFrame(frameTwo);
    delete (window as Window & {__MAONO_MAP_LAYOUT_DEBUG__?: typeof debugApi}).__MAONO_MAP_LAYOUT_DEBUG__;
  };
}
