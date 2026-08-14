// @ts-nocheck
import "maplibre-gl/dist/maplibre-gl.css";
import "mapbox-gl/dist/mapbox-gl.css";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Provider, useDispatch } from "react-redux";
import { addDataToMap, resetMapConfig, toggleModal, wrapTo } from "@kepler.gl/actions";
import { injectComponents } from "@kepler.gl/components";
import KeplerGlSchema from "@kepler.gl/schemas";
import { theme } from "@kepler.gl/styles";
import { ThemeProvider } from "styled-components";

import store from "../../store";
import { CLOUD_PROVIDERS_CONFIGURATION } from "../../pages/Kepler/constants/default-settings";

const MAP_ID = "s08-benchmark";
const PENDING_KEY = "maono:s08:pending-run";
const RESULT_ENDPOINT = "/__s08_results__";
const MANIFEST_URL = "/__s08_fixture__/manifest.json";
const KeplerGl = injectComponents([]);
const getKeplerState = (state: any) => state.demo.keplerGl;
const observedWebglCanvases = new WeakSet<HTMLCanvasElement>();
const observedMaps = new WeakSet<object>();

const DEVICE_CLASSES = [
  "ENTRY_NOTEBOOK",
  "STANDARD_NOTEBOOK",
  "HIGH_END_DESKTOP",
  "SUPPORTED_MOBILE",
];

type ActiveRun = {
  runId: string;
  startedAt: number;
  measurementStartedAt: number | null;
  fixture: any;
  deviceClass: string;
  cacheMode: "COLD" | "WARM";
  hydrationStartedAt: number | null;
  metrics: Record<string, any>;
  longTasks: number[];
  observer: PerformanceObserver | null;
  timeoutId: number | null;
  webglContextLostCount: number;
  webglContextRestoredCount: number;
  webglObservedCanvases: Set<HTMLCanvasElement>;
  webglCanvasObserver: MutationObserver | null;
  webglCanvasAddedDuringRunCount: number;
  webglPrimaryCanvasChangeCount: number;
  initialPrimaryCanvas: HTMLCanvasElement | null;
  lastPrimaryCanvas: HTMLCanvasElement | null;
  webglPrimaryContextLostAtEnd: boolean | null;
  done: boolean;
};

function now() {
  return performance.now();
}

function heapSize() {
  return Number((performance as any)?.memory?.usedJSHeapSize || 0) || null;
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index];
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeDatasetForKepler(dataset: any) {
  const data = dataset?.data ?? dataset;
  return {
    info: {
      id: data?.id ?? dataset?.id,
      label: data?.label ?? dataset?.label ?? data?.id ?? dataset?.id,
      color: data?.color ?? dataset?.color,
    },
    data,
  };
}

function loadSavedKeplerConfigForBenchmark(savedConfig: any) {
  if (!isRecord(savedConfig)) throw new Error("SAVED_CONFIG_INVALID_ROOT");
  if (!Array.isArray(savedConfig.datasets)) throw new Error("SAVED_CONFIG_INVALID_DATASETS");
  if (!isRecord(savedConfig.config)) throw new Error("SAVED_CONFIG_INVALID_CONFIG");

  try {
    const loaded = KeplerGlSchema.load(savedConfig) as any;
    if (isRecord(loaded)) {
      return {
        datasets: Array.isArray(loaded.datasets)
          ? loaded.datasets
          : savedConfig.datasets.map(normalizeDatasetForKepler),
        config: isRecord(loaded.config) ? loaded.config : savedConfig.config,
      };
    }
  } catch {
    // O loader de produção também preserva um fallback seguro quando o
    // Schema.load não aceita a forma persistida. O benchmark mede esse caminho.
  }

  return {
    datasets: savedConfig.datasets.map(normalizeDatasetForKepler),
    config: savedConfig.config,
  };
}

function browserClass() {
  const brands = (navigator as any).userAgentData?.brands;
  if (Array.isArray(brands) && brands.length) {
    return brands.map((item: any) => `${item.brand}/${item.version}`).join(" ").slice(0, 120);
  }
  const match = navigator.userAgent.match(/(Chrome|Edg|Firefox|Safari)\/[0-9.]+/i);
  return match?.[0] || "browser-unknown";
}

function createLongTaskObserver(target: number[]) {
  if (typeof PerformanceObserver === "undefined") return null;
  if (!PerformanceObserver.supportedEntryTypes?.includes("longtask")) return null;
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) target.push(entry.duration);
  });
  observer.observe({ entryTypes: ["longtask"] });
  return observer;
}

function waitFrames(count = 2) {
  return new Promise<void>((resolve) => {
    const step = () => {
      if (count <= 0) resolve();
      else {
        count -= 1;
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  });
}

function inspectMapWebgl(map: any) {
  const canvas = map?.getCanvas?.() || null;
  if (!canvas) {
    return { canvas: null, available: false, version: null, contextLost: null };
  }

  let gl: any = null;
  try {
    gl = canvas.getContext("webgl2") || canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  } catch {
    gl = null;
  }

  let contextLost: boolean | null = null;
  try {
    contextLost = typeof gl?.isContextLost === "function" ? Boolean(gl.isContextLost()) : null;
  } catch {
    contextLost = null;
  }

  return {
    canvas,
    available: Boolean(gl),
    version: gl?.getParameter?.(gl.VERSION)?.toString?.().slice(0, 24) || null,
    contextLost,
  };
}

async function measureInteractionFps(map: any) {
  const frameTimes: number[] = [];
  const start = now();
  let previous = start;
  const durationMs = 2200;

  const animation = new Promise<void>((resolve) => {
    const tick = (timestamp: number) => {
      frameTimes.push(timestamp - previous);
      previous = timestamp;
      if (timestamp - start >= durationMs) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  try {
    const center = map?.getCenter?.();
    const zoom = Number(map?.getZoom?.() ?? 2);
    if (center && map?.easeTo) {
      map.easeTo({
        center: [Number(center.lng) + 0.8, Number(center.lat) + 0.35],
        zoom: zoom + 0.8,
        duration: 850,
      });
      window.setTimeout(() => {
        map.easeTo({
          center: [Number(center.lng), Number(center.lat)],
          zoom,
          duration: 850,
        });
      }, 950);
    }
  } catch {
    // FPS continua mensurável mesmo se a câmera não puder ser automatizada.
  }

  await animation;
  const elapsed = Math.max(1, now() - start);
  const usefulFrames = frameTimes.filter((value) => value > 0 && value < 1000);
  return {
    averageFps: (usefulFrames.length * 1000) / elapsed,
    medianFrameMs: median(usefulFrames),
    p95FrameMs: percentile(usefulFrames, 0.95),
    worstFrameMs: usefulFrames.length ? Math.max(...usefulFrames) : null,
    droppedFrameCount: usefulFrames.filter((value) => value > 33.34).length,
  };
}

async function postResult(result: any) {
  const response = await fetch(RESULT_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(result),
  });
  if (!response.ok) throw new Error(`Collector S08 retornou HTTP ${response.status}.`);
}

function BenchmarkApp() {
  const dispatch = useDispatch();
  const [manifest, setManifest] = useState<any>(null);
  const [fixtureId, setFixtureId] = useState("");
  const [deviceClass, setDeviceClass] = useState("STANDARD_NOTEBOOK");
  const [cacheMode, setCacheMode] = useState<"COLD" | "WARM">("COLD");
  const [status, setStatus] = useState("Carregando manifesto local...");
  const [lastResult, setLastResult] = useState<any>(null);
  const activeRunRef = useRef<ActiveRun | null>(null);
  const mapRef = useRef<any>(null);
  const mapAreaRef = useRef<HTMLElement | null>(null);
  const webglRef = useRef({ available: false, version: null as string | null });
  const finalizingRef = useRef(false);

  const selectedFixture = useMemo(
    () => manifest?.fixtures?.find((entry: any) => entry.fixtureId === fixtureId) || null,
    [fixtureId, manifest],
  );

  const canvasRemainsRelevant = useCallback((canvas: HTMLCanvasElement) => {
    const root = mapAreaRef.current;
    const primaryCanvas = mapRef.current?.getCanvas?.() || null;
    return primaryCanvas === canvas || Boolean(root && canvas.isConnected && root.contains(canvas));
  }, []);

  const observeCanvasForRun = useCallback((run: ActiveRun, canvas: HTMLCanvasElement, addedDuringRun: boolean) => {
    if (!canvas) return;
    const isNewToRun = !run.webglObservedCanvases.has(canvas);
    if (isNewToRun) {
      run.webglObservedCanvases.add(canvas);
      if (addedDuringRun && run.measurementStartedAt != null) {
        run.webglCanvasAddedDuringRunCount += 1;
      }
    }

    if (observedWebglCanvases.has(canvas)) return;
    observedWebglCanvases.add(canvas);

    canvas.addEventListener("webglcontextlost", () => {
      const currentRun = activeRunRef.current;
      if (
        !currentRun ||
        currentRun.done ||
        currentRun.measurementStartedAt == null ||
        !currentRun.webglObservedCanvases.has(canvas)
      ) return;

      // Deck/Kepler pode destruir um canvas antigo durante a troca normal da
      // instância de renderização. Alguns browsers disparam webglcontextlost ao
      // liberar esse contexto. Isso não é equivalente a uma perda da GPU ativa.
      // Esperamos um frame para distinguir descarte de lifecycle (canvas removido)
      // de context loss em canvas que permaneceu ativo/conectado.
      window.requestAnimationFrame(() => {
        const pendingRun = activeRunRef.current;
        if (
          !pendingRun ||
          pendingRun.done ||
          pendingRun.measurementStartedAt == null ||
          !pendingRun.webglObservedCanvases.has(canvas)
        ) return;
        if (!canvasRemainsRelevant(canvas)) return;
        pendingRun.webglContextLostCount += 1;
      });
    });

    canvas.addEventListener("webglcontextrestored", () => {
      const currentRun = activeRunRef.current;
      if (
        !currentRun ||
        currentRun.done ||
        currentRun.measurementStartedAt == null ||
        !currentRun.webglObservedCanvases.has(canvas) ||
        !canvasRemainsRelevant(canvas)
      ) return;
      currentRun.webglContextRestoredCount += 1;
    });
  }, [canvasRemainsRelevant]);

  const trackPrimaryCanvas = useCallback((run: ActiveRun, canvas: HTMLCanvasElement | null, addedDuringRun: boolean) => {
    if (!canvas) return;
    observeCanvasForRun(run, canvas, addedDuringRun);
    if (!run.initialPrimaryCanvas) run.initialPrimaryCanvas = canvas;
    if (run.lastPrimaryCanvas && run.lastPrimaryCanvas !== canvas) {
      run.webglPrimaryCanvasChangeCount += 1;
    }
    run.lastPrimaryCanvas = canvas;
  }, [observeCanvasForRun]);

  const scanWebglCanvases = useCallback((run: ActiveRun, addedDuringRun: boolean) => {
    const root = mapAreaRef.current;
    if (root) {
      const canvases = Array.from(root.querySelectorAll("canvas"));
      for (const canvas of canvases) observeCanvasForRun(run, canvas, addedDuringRun);
    }
    const primaryCanvas = mapRef.current?.getCanvas?.() || null;
    trackPrimaryCanvas(run, primaryCanvas, addedDuringRun);
  }, [observeCanvasForRun, trackPrimaryCanvas]);

  const updateWebglSnapshot = useCallback((run: ActiveRun, addedDuringRun = true) => {
    scanWebglCanvases(run, addedDuringRun);
    const inspected = inspectMapWebgl(mapRef.current);
    webglRef.current = {
      available: inspected.available,
      version: inspected.version,
    };
    trackPrimaryCanvas(run, inspected.canvas, addedDuringRun);
    run.webglPrimaryContextLostAtEnd = inspected.contextLost;
  }, [scanWebglCanvases, trackPrimaryCanvas]);

  const startWebglObservation = useCallback((run: ActiveRun) => {
    scanWebglCanvases(run, false);
    const inspected = inspectMapWebgl(mapRef.current);
    webglRef.current = {
      available: inspected.available,
      version: inspected.version,
    };
    trackPrimaryCanvas(run, inspected.canvas, false);
    run.webglPrimaryContextLostAtEnd = inspected.contextLost;

    const root = mapAreaRef.current;
    if (!root || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      if (run.done || activeRunRef.current !== run) return;
      scanWebglCanvases(run, true);
    });
    observer.observe(root, { childList: true, subtree: true });
    run.webglCanvasObserver = observer;
  }, [scanWebglCanvases, trackPrimaryCanvas]);

  const emitResult = useCallback(async (run: ActiveRun, outcome: string, errorCode: string | null = null) => {
    if (run.done) return;
    updateWebglSnapshot(run, true);
    run.done = true;
    if (run.timeoutId !== null) window.clearTimeout(run.timeoutId);
    run.observer?.disconnect();
    run.webglCanvasObserver?.disconnect();

    const longTasks = run.longTasks;
    const result = {
      benchmarkVersion: "s08-benchmark-v1",
      runId: run.runId,
      fixtureId: run.fixture.fixtureId,
      commit: import.meta.env.VITE_GIT_COMMIT || null,
      deviceClass: run.deviceClass,
      browserClass: browserClass(),
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      cacheMode: run.cacheMode,
      input: {
        sizeBytes: run.fixture.sizeBytes,
        featureCount: run.fixture.featureCount,
        coordinatePositionCount: run.fixture.coordinatePositionCount,
        maxFeaturePositionCount: run.fixture.maxFeaturePositionCount,
        geometryProfile: run.fixture.geometryProfile,
        visibleLayerCount: run.fixture.layerCount,
      },
      metrics: {
        ...run.metrics,
        longTaskCount: longTasks.length,
        longTaskTotalMs: longTasks.reduce((sum, value) => sum + value, 0),
        maxLongTaskMs: longTasks.length ? Math.max(...longTasks) : 0,
        webglAvailable: webglRef.current.available,
        webglVersion: webglRef.current.version,
        webglContextLostCount: run.webglContextLostCount,
        webglContextRestoredCount: run.webglContextRestoredCount,
        webglObservedCanvasCount: run.webglObservedCanvases.size,
        webglCanvasAddedDuringRunCount: run.webglCanvasAddedDuringRunCount,
        webglPrimaryCanvasChangeCount: run.webglPrimaryCanvasChangeCount,
        webglPrimaryContextLostAtEnd: run.webglPrimaryContextLostAtEnd,
        jsHeapAfter: heapSize(),
      },
      outcome,
      errorCode,
      recordedAt: new Date().toISOString(),
    };

    sessionStorage.removeItem(PENDING_KEY);
    activeRunRef.current = null;
    finalizingRef.current = false;
    setLastResult(result);
    setStatus(outcome === "SUCCESS" ? "Execução concluída." : `Execução terminou em ${outcome}.`);
    try {
      await postResult(result);
    } catch (error) {
      setStatus(`${outcome}; resultado não persistido: ${String(error?.message || error)}`);
    }
  }, [updateWebglSnapshot]);

  const finalizeSuccessfulRun = useCallback(async () => {
    const run = activeRunRef.current;
    if (!run || run.done || finalizingRef.current || run.hydrationStartedAt == null) return;
    finalizingRef.current = true;
    await waitFrames(2);
    if (run.done || activeRunRef.current !== run) return;

    run.metrics.engineHydrationToReadyMs = now() - run.hydrationStartedAt;
    run.metrics.mapReadyMs = now() - run.startedAt;
    run.metrics.jsHeapPeak = Math.max(
      Number(run.metrics.jsHeapBefore || 0),
      Number(heapSize() || 0),
    ) || null;

    const fps = await measureInteractionFps(mapRef.current);
    if (run.done || activeRunRef.current !== run) return;
    Object.assign(run.metrics, fps);
    updateWebglSnapshot(run, true);

    if (run.webglContextLostCount > 0 || run.webglPrimaryContextLostAtEnd === true) {
      await emitResult(run, "WEBGL_CONTEXT_LOST", "WEBGL_CONTEXT_LOST_DURING_BENCHMARK");
      return;
    }
    await emitResult(run, "SUCCESS");
  }, [emitResult, updateWebglSnapshot]);

  const attachMap = useCallback((ref: any) => {
    const map = ref?.getMap?.() || ref || null;
    mapRef.current = map;
    if (!map) return;

    const inspected = inspectMapWebgl(map);
    webglRef.current = {
      available: inspected.available,
      version: inspected.version,
    };

    const run = activeRunRef.current;
    if (run && !run.done && run.measurementStartedAt != null) {
      trackPrimaryCanvas(run, inspected.canvas, true);
      run.webglPrimaryContextLostAtEnd = inspected.contextLost;
    }

    if (typeof map === "object" && observedMaps.has(map)) return;
    if (typeof map === "object") observedMaps.add(map);
    map.on?.("render", () => {
      const currentRun = activeRunRef.current;
      if (!currentRun || currentRun.done || currentRun.hydrationStartedAt == null) return;
      if (map.isStyleLoaded?.() === false) return;
      void finalizeSuccessfulRun();
    });
  }, [finalizeSuccessfulRun, trackPrimaryCanvas]);

  useEffect(() => {
    const closeNativeModal = () => {
      dispatch(wrapTo(MAP_ID, toggleModal(null)));
    };
    closeNativeModal();
    const frameId = window.requestAnimationFrame(closeNativeModal);
    return () => window.cancelAnimationFrame(frameId);
  }, [dispatch]);

  useEffect(() => {
    fetch(MANIFEST_URL, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        setManifest(data);
        setFixtureId(data?.fixtures?.[0]?.fixtureId || "");
        setStatus("Harness pronto. Selecione um fixture e execute.");
      })
      .catch((error) => {
        setStatus(`Manifesto indisponível: ${String(error?.message || error)}. Execute benchmark:s08:generate.`);
      });
  }, []);

  useEffect(() => {
    const pendingRaw = sessionStorage.getItem(PENDING_KEY);
    if (!pendingRaw) return;
    try {
      const pending = JSON.parse(pendingRaw);
      if (!pending?.runId || !pending?.fixture) return;
      const interrupted = {
        benchmarkVersion: "s08-benchmark-v1",
        runId: pending.runId,
        fixtureId: pending.fixture.fixtureId,
        commit: import.meta.env.VITE_GIT_COMMIT || null,
        deviceClass: pending.deviceClass,
        browserClass: browserClass(),
        viewport: {
          width: window.innerWidth,
          height: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
        },
        cacheMode: pending.cacheMode,
        input: {
          sizeBytes: pending.fixture.sizeBytes,
          featureCount: pending.fixture.featureCount,
          coordinatePositionCount: pending.fixture.coordinatePositionCount,
          maxFeaturePositionCount: pending.fixture.maxFeaturePositionCount,
          geometryProfile: pending.fixture.geometryProfile,
          visibleLayerCount: pending.fixture.layerCount,
        },
        metrics: {},
        outcome: "RELOAD",
        errorCode: "PAGE_RELOADED_DURING_BENCHMARK",
        recordedAt: new Date().toISOString(),
      };
      sessionStorage.removeItem(PENDING_KEY);
      setLastResult(interrupted);
      void postResult(interrupted).catch(() => null);
    } catch {
      sessionStorage.removeItem(PENDING_KEY);
    }
  }, []);

  const runBenchmark = useCallback(async () => {
    if (!selectedFixture || activeRunRef.current) return;
    const runId = crypto.randomUUID?.() || `s08-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const run: ActiveRun = {
      runId,
      startedAt: 0,
      measurementStartedAt: null,
      fixture: selectedFixture,
      deviceClass,
      cacheMode,
      hydrationStartedAt: null,
      metrics: {},
      longTasks: [],
      observer: null,
      timeoutId: null,
      webglContextLostCount: 0,
      webglContextRestoredCount: 0,
      webglObservedCanvases: new Set(),
      webglCanvasObserver: null,
      webglCanvasAddedDuringRunCount: 0,
      webglPrimaryCanvasChangeCount: 0,
      initialPrimaryCanvas: null,
      lastPrimaryCanvas: null,
      webglPrimaryContextLostAtEnd: null,
      done: false,
    };
    activeRunRef.current = run;
    finalizingRef.current = false;
    setLastResult(null);
    setStatus(`Preparando ${selectedFixture.fixtureId}...`);

    try {
      // Higiene do harness: limpar o estado anterior não faz parte da pipeline
      // medida e pode descartar canvases/WebGL antigos de forma intencional.
      dispatch(wrapTo(MAP_ID, toggleModal(null)));
      dispatch(wrapTo(MAP_ID, resetMapConfig()));
      dispatch(wrapTo(MAP_ID, toggleModal(null)));
      await waitFrames(4);
      dispatch(wrapTo(MAP_ID, toggleModal(null)));
      await waitFrames(2);

      if (activeRunRef.current !== run || run.done) return;

      run.startedAt = now();
      run.measurementStartedAt = run.startedAt;
      run.metrics.jsHeapBefore = heapSize();
      run.observer = createLongTaskObserver(run.longTasks);
      startWebglObservation(run);
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({
        runId,
        fixture: selectedFixture,
        deviceClass,
        cacheMode,
        startedAt: Date.now(),
      }));
      setStatus(`Executando ${selectedFixture.fixtureId}...`);

      run.timeoutId = window.setTimeout(() => {
        if (activeRunRef.current !== run || run.done) return;
        updateWebglSnapshot(run, true);
        const timeoutAfterContextLoss =
          run.webglContextLostCount > 0 || run.webglPrimaryContextLostAtEnd === true;
        const timeoutAfterCanvasChange = run.webglPrimaryCanvasChangeCount > 0;
        const errorCode = timeoutAfterContextLoss
          ? "BENCHMARK_TIMEOUT_AFTER_WEBGL_CONTEXT_LOSS"
          : timeoutAfterCanvasChange
            ? "BENCHMARK_TIMEOUT_AFTER_WEBGL_CANVAS_CHANGE"
            : "BENCHMARK_TIMEOUT";
        void emitResult(run, "TIMEOUT", errorCode);
      }, 120_000);

      const baseUrl = `/__s08_fixture__/fixtures/${encodeURIComponent(selectedFixture.fileName)}`;
      const fixtureUrl = cacheMode === "COLD" ? `${baseUrl}?run=${encodeURIComponent(runId)}` : baseUrl;
      const fetchStarted = now();
      const response = await fetch(fixtureUrl, {
        cache: cacheMode === "COLD" ? "reload" : "force-cache",
      });
      const headersAt = now();
      if (!response.ok) throw new Error(`FIXTURE_HTTP_${response.status}`);
      const text = await response.text();
      const bodyAt = now();
      run.metrics.ttfbMs = headersAt - fetchStarted;
      run.metrics.downloadBodyMs = bodyAt - headersAt;
      run.metrics.downloadTotalMs = bodyAt - fetchStarted;

      const parseStarted = now();
      const savedConfig = JSON.parse(text);
      run.metrics.browserJsonParseMs = now() - parseStarted;

      const schemaStarted = now();
      const loaded = loadSavedKeplerConfigForBenchmark(savedConfig);
      run.metrics.schemaLoadMs = now() - schemaStarted;

      run.hydrationStartedAt = now();
      const dispatchStarted = now();
      dispatch(
        wrapTo(
          MAP_ID,
          addDataToMap({
            datasets: loaded.datasets,
            config: loaded.config,
            options: { centerMap: true, readOnly: true },
          }),
        ),
      );
      run.metrics.addDataToMapDispatchMs = now() - dispatchStarted;
    } catch (error) {
      await emitResult(run, "ERROR", String(error?.message || error).slice(0, 120));
    }
  }, [cacheMode, deviceClass, dispatch, emitResult, selectedFixture, startWebglObservation, updateWebglSnapshot]);

  return (
    <ThemeProvider theme={theme}>
      <div style={{ display: "grid", gridTemplateColumns: "360px minmax(0, 1fr)", width: "100%", height: "100%" }}>
        <aside style={{ padding: 18, borderRight: "1px solid #3f382a", overflow: "auto", background: "#11100d" }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>S08 Benchmark Harness</h1>
          <p style={{ color: "#c9bea9", fontSize: 13, lineHeight: 1.5 }}>
            Mede a pipeline real do browser. Não calcula nem aplica limites safe/warn/block.
          </p>

          <label style={{ display: "block", marginTop: 16 }}>Dispositivo</label>
          <select value={deviceClass} onChange={(event) => setDeviceClass(event.target.value)} style={{ width: "100%", padding: 8, marginTop: 6 }}>
            {DEVICE_CLASSES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>

          <label style={{ display: "block", marginTop: 16 }}>Fixture</label>
          <select value={fixtureId} onChange={(event) => setFixtureId(event.target.value)} style={{ width: "100%", padding: 8, marginTop: 6 }}>
            {(manifest?.fixtures || []).map((fixture: any) => (
              <option key={fixture.fixtureId} value={fixture.fixtureId}>{fixture.fixtureId}</option>
            ))}
          </select>

          <label style={{ display: "block", marginTop: 16 }}>Cache</label>
          <select value={cacheMode} onChange={(event) => setCacheMode(event.target.value as any)} style={{ width: "100%", padding: 8, marginTop: 6 }}>
            <option value="COLD">COLD</option>
            <option value="WARM">WARM</option>
          </select>

          <button disabled={!selectedFixture || Boolean(activeRunRef.current)} onClick={runBenchmark} style={{ width: "100%", padding: 12, marginTop: 18, fontWeight: 700 }}>
            Executar benchmark
          </button>

          <p style={{ fontSize: 12, lineHeight: 1.5, color: "#e8d6ab" }}>{status}</p>
          {selectedFixture && (
            <pre style={{ fontSize: 11, whiteSpace: "pre-wrap", color: "#b8b09f" }}>{JSON.stringify({
              sizeMiB: (selectedFixture.sizeBytes / 1024 / 1024).toFixed(2),
              featureCount: selectedFixture.featureCount,
              positions: selectedFixture.coordinatePositionCount,
              maxFeaturePositions: selectedFixture.maxFeaturePositionCount,
              geometry: selectedFixture.geometryProfile,
              layers: selectedFixture.layerCount,
            }, null, 2)}</pre>
          )}
          {lastResult && <pre style={{ fontSize: 10, whiteSpace: "pre-wrap", color: "#d8d2c4" }}>{JSON.stringify(lastResult, null, 2)}</pre>}
        </aside>

        <main ref={mapAreaRef} style={{ minWidth: 0, minHeight: 0, position: "relative" }}>
          <KeplerGl
            id={MAP_ID}
            getState={getKeplerState}
            width={Math.max(640, window.innerWidth - 360)}
            height={Math.max(480, window.innerHeight)}
            mapboxApiAccessToken={CLOUD_PROVIDERS_CONFIGURATION.MAPBOX_TOKEN}
            getMapboxRef={attachMap}
          />
        </main>
      </div>
    </ThemeProvider>
  );
}

const root = document.getElementById("s08-root");
if (!root) throw new Error("S08 root não encontrado.");
createRoot(root).render(
  <Provider store={store}>
    <BenchmarkApp />
  </Provider>,
);
