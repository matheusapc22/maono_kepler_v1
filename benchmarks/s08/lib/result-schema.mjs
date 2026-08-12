import { DEVICE_CLASSES, S08_BENCHMARK_VERSION } from "../corpus-spec.mjs";

export const S08_OUTCOMES = Object.freeze([
  "SUCCESS",
  "ERROR",
  "TIMEOUT",
  "RELOAD",
  "WEBGL_CONTEXT_LOST",
  "PAGE_CRASH",
  "INCOMPLETE",
]);

const FORBIDDEN_KEYS = /(?:dataset|geojson|feature|coordinates?|geometry|mapconfig|token|cookie|authorization|dropbox|sql|row|payload|rawdata)/i;

function finiteOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function integerOrNull(value) {
  const number = finiteOrNull(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function safeText(value, max = 160) {
  if (typeof value !== "string") return null;
  return value.trim().slice(0, max) || null;
}

function assertNoForbiddenKeys(value, path = "result") {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.test(key)) {
      throw new Error(`Campo proibido no resultado S08: ${path}.${key}`);
    }
    if (nested && typeof nested === "object") {
      assertNoForbiddenKeys(nested, `${path}.${key}`);
    }
  }
}

export function normalizeBenchmarkResult(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Resultado S08 inválido.");
  }
  assertNoForbiddenKeys(input);

  const deviceClass = safeText(input.deviceClass, 40);
  if (!DEVICE_CLASSES.includes(deviceClass)) {
    throw new Error(`deviceClass S08 inválido: ${deviceClass}`);
  }
  const outcome = safeText(input.outcome, 40);
  if (!S08_OUTCOMES.includes(outcome)) {
    throw new Error(`outcome S08 inválido: ${outcome}`);
  }

  const metrics = input.metrics && typeof input.metrics === "object" ? input.metrics : {};
  const normalized = {
    benchmarkVersion: S08_BENCHMARK_VERSION,
    runId: safeText(input.runId, 120),
    fixtureId: safeText(input.fixtureId, 120),
    commit: safeText(input.commit, 64),
    deviceClass,
    browserClass: safeText(input.browserClass, 120),
    viewport: {
      width: integerOrNull(input.viewport?.width),
      height: integerOrNull(input.viewport?.height),
      devicePixelRatio: finiteOrNull(input.viewport?.devicePixelRatio),
    },
    cacheMode: input.cacheMode === "WARM" ? "WARM" : "COLD",
    input: {
      sizeBytes: integerOrNull(input.input?.sizeBytes),
      featureCount: integerOrNull(input.input?.featureCount),
      coordinatePositionCount: integerOrNull(input.input?.coordinatePositionCount),
      maxFeaturePositionCount: integerOrNull(input.input?.maxFeaturePositionCount),
      geometryProfile: safeText(input.input?.geometryProfile, 80),
      visibleLayerCount: integerOrNull(input.input?.visibleLayerCount),
    },
    metrics: {
      ttfbMs: finiteOrNull(metrics.ttfbMs),
      downloadBodyMs: finiteOrNull(metrics.downloadBodyMs),
      downloadTotalMs: finiteOrNull(metrics.downloadTotalMs),
      browserJsonParseMs: finiteOrNull(metrics.browserJsonParseMs),
      schemaLoadMs: finiteOrNull(metrics.schemaLoadMs),
      addDataToMapDispatchMs: finiteOrNull(metrics.addDataToMapDispatchMs),
      engineHydrationToReadyMs: finiteOrNull(metrics.engineHydrationToReadyMs),
      mapReadyMs: finiteOrNull(metrics.mapReadyMs),
      longTaskCount: integerOrNull(metrics.longTaskCount),
      longTaskTotalMs: finiteOrNull(metrics.longTaskTotalMs),
      maxLongTaskMs: finiteOrNull(metrics.maxLongTaskMs),
      averageFps: finiteOrNull(metrics.averageFps),
      medianFrameMs: finiteOrNull(metrics.medianFrameMs),
      p95FrameMs: finiteOrNull(metrics.p95FrameMs),
      worstFrameMs: finiteOrNull(metrics.worstFrameMs),
      droppedFrameCount: integerOrNull(metrics.droppedFrameCount),
      webglAvailable: typeof metrics.webglAvailable === "boolean" ? metrics.webglAvailable : null,
      webglVersion: safeText(metrics.webglVersion, 24),
      webglContextLostCount: integerOrNull(metrics.webglContextLostCount),
      webglContextRestoredCount: integerOrNull(metrics.webglContextRestoredCount),
      jsHeapBefore: finiteOrNull(metrics.jsHeapBefore),
      jsHeapPeak: finiteOrNull(metrics.jsHeapPeak),
      jsHeapAfter: finiteOrNull(metrics.jsHeapAfter),
    },
    outcome,
    errorCode: safeText(input.errorCode, 120),
    recordedAt: safeText(input.recordedAt, 40) || new Date().toISOString(),
  };

  if (!normalized.runId || !normalized.fixtureId) {
    throw new Error("Resultado S08 requer runId e fixtureId.");
  }
  return normalized;
}
