import { useEffect, useRef, useState } from "react";
import { connect } from "react-redux";
import { useParams } from "react-router";
import { addDataToMap, toggleModal } from "@kepler.gl/actions";
import KeplerGlSchema from "@kepler.gl/schemas";
import { selectIsMapLoading } from "../reducers/selectors";
import { setLoadingMapStatus } from "../actions";
import Spinner from "../../../components/Spinner";
import { prepareSavedConfigForPointClustering } from "../clustering/point-cluster-controller.ts";
import { isPointClusteringFeatureEnabled } from "../clustering/point-cluster-policy.ts";
import { loadPointClusterState } from "../clustering/point-cluster-store.ts";
import { useMapPanel } from "../map-panel/MapPanelContext";
import {
  failActiveMapLoadTrace,
  recordMapLoadEvent,
  updateActiveMapLoadTraceContext,
} from "../observability/map-load-trace";

const POINT_CLUSTERING_FEATURE_ENABLED =
  isPointClusteringFeatureEnabled(
    import.meta.env.VITE_POINT_CLUSTERING_V1,
  );
const PROJECT_LOAD_RETRY_DELAYS_MS = [350, 900];

// Operational fast path only. This is not a final Safety Plane threshold and
// does not block datasets. It merely avoids redundant schema work for already
// current Kepler documents when the persisted MapConfig is large.
const LARGE_CONFIG_FAST_PATH_BYTES = 10 * 1024 * 1024;

const mapStateToProps = (state: any) => ({
  isMapLoading: selectIsMapLoading(state),
  currentModal:
    state?.demo?.keplerGl?.map?.uiState?.currentModal ?? null,
});

const dispatchToProps = (dispatch: any) => ({ dispatch });

const connectStore = connect(mapStateToProps, dispatchToProps);

async function parseJsonResponse(response: Response) {
  try {
    return await response.json();
  } catch {
    throw new Error("A resposta do servidor não está em JSON válido.");
  }
}

function getApiErrorMessage(data: any, fallback: string) {
  return data?.error?.message || data?.message || fallback;
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validateSavedKeplerConfig(value: unknown) {
  if (!isRecord(value)) {
    throw new Error("Configuração do projeto inválida.");
  }

  if (!Array.isArray(value.datasets)) {
    throw new Error("A configuração do projeto não possui datasets válidos.");
  }

  if (!isRecord(value.config)) {
    throw new Error("A configuração do projeto não possui objeto config válido.");
  }
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

function isCurrentKeplerDocument(savedConfig: any) {
  return String(savedConfig?.version ?? "").trim().toLowerCase() === "v1";
}

function directKeplerPayload(savedConfig: any) {
  return {
    datasets: savedConfig.datasets.map(normalizeDatasetForKepler),
    config: savedConfig.config,
  };
}

export function loadSavedKeplerConfig(
  savedConfig: any,
  { sizeBytes = 0 }: { sizeBytes?: number } = {},
) {
  validateSavedKeplerConfig(savedConfig);

  const prepared = prepareSavedConfigForPointClustering(
    savedConfig,
    {
      featureEnabled: POINT_CLUSTERING_FEATURE_ENABLED,
    },
  );
  loadPointClusterState(prepared.savedConfig.maono);

  const useLargeConfigFastPath =
    Number(sizeBytes || 0) >= LARGE_CONFIG_FAST_PATH_BYTES &&
    isCurrentKeplerDocument(prepared.savedConfig);

  if (useLargeConfigFastPath) {
    // KeplerGlSchema.load may materialize another large representation of the
    // same datasets. Saved v1 documents can use the same fallback contract we
    // already use when schema loading fails, but proactively and deterministically.
    recordMapLoadEvent("MIGRATED");
    return directKeplerPayload(prepared.savedConfig);
  }

  try {
    const loaded = KeplerGlSchema.load(
      prepared.savedConfig,
    ) as any;

    if (isRecord(loaded)) {
      const datasets = Array.isArray(loaded.datasets)
        ? loaded.datasets
        : prepared.savedConfig.datasets.map(normalizeDatasetForKepler);

      const config =
        loaded.config ?? prepared.savedConfig.config;

      recordMapLoadEvent("MIGRATED");
      return {
        datasets,
        config,
      };
    }
  } catch (error) {
    console.warn(
      "[Maono map loader] KeplerGlSchema.load falhou, usando fallback seguro:",
      error,
    );
  }

  recordMapLoadEvent("MIGRATED");
  return directKeplerPayload(prepared.savedConfig);
}

function retryableProjectStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function waitForRetry(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const timeoutId = window.setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, milliseconds);

    function handleAbort() {
      window.clearTimeout(timeoutId);
      reject(new DOMException("Aborted", "AbortError"));
    }

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function yieldToBrowser(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    });

    function handleAbort() {
      window.cancelAnimationFrame(frameId);
      reject(new DOMException("Aborted", "AbortError"));
    }

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

function numericHeader(response: Response, name: string) {
  const value = Number(response.headers.get(name));
  return Number.isFinite(value) ? value : null;
}

async function requestProjectConfigResponse(
  projectSlug: string,
  signal: AbortSignal,
) {
  const totalAttempts = PROJECT_LOAD_RETRY_DELAYS_MS.length + 1;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectSlug)}/config-stream`,
        {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json",
          },
          signal,
        },
      );

      if (
        retryableProjectStatus(response.status) &&
        attempt < PROJECT_LOAD_RETRY_DELAYS_MS.length
      ) {
        response.body?.cancel().catch(() => undefined);
        await waitForRetry(PROJECT_LOAD_RETRY_DELAYS_MS[attempt], signal);
        continue;
      }

      return response;
    } catch (error) {
      if (signal.aborted) throw error;
      lastError = error;

      if (attempt >= PROJECT_LOAD_RETRY_DELAYS_MS.length) {
        throw error;
      }

      await waitForRetry(PROJECT_LOAD_RETRY_DELAYS_MS[attempt], signal);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Não foi possível carregar o projeto.");
}

async function requestProjectConfig(
  projectSlug: string,
  signal: AbortSignal,
) {
  const response = await requestProjectConfigResponse(projectSlug, signal);

  if (!response.ok) {
    return {
      response,
      data: await parseJsonResponse(response),
      sizeBytes: 0,
    };
  }

  if (response.headers.get("X-Maono-Config-Transport") !== "stream") {
    throw new Error("O servidor não confirmou o transporte otimizado do projeto.");
  }

  let config: any;
  try {
    // Do not retry a successful HTTP response that contains invalid JSON. A
    // second parse of the same huge immutable revision only multiplies memory
    // pressure and cannot repair corrupted content.
    config = await response.json();
  } catch {
    throw new Error("A configuração armazenada não está em JSON válido.");
  }

  const projectId = numericHeader(response, "X-Maono-Project-Id");
  const revision = numericHeader(response, "X-Maono-Config-Revision");
  const schemaVersion = numericHeader(
    response,
    "X-Maono-Config-Schema-Version",
  );
  const sizeBytes =
    numericHeader(response, "X-Maono-Config-Size") ?? 0;

  return {
    response,
    sizeBytes,
    data: {
      ok: true,
      project: {
        id: projectId,
        configRevision: revision,
      },
      lifecycle: {
        configRevision: revision,
        schema: {
          name: response.headers.get("X-Maono-Config-Schema"),
          version: schemaVersion,
        },
      },
      config,
    },
  };
}

async function loadProjectConfig(
  projectSlug: string,
  dispatch: any,
  signal: AbortSignal,
  readOnly: boolean,
) {
  dispatch(toggleModal(null));
  dispatch(setLoadingMapStatus(true));

  try {
    const { response, data, sizeBytes } = await requestProjectConfig(
      projectSlug,
      signal,
    );

    if (!response.ok || !data?.ok) {
      failActiveMapLoadTrace({
        stage: "CONFIG_VALIDATED",
        code: data?.error?.code || "MAP_CONFIG_LOAD_FAILED",
        category: data?.error?.category || "MAP_CONFIG",
        retryable:
          typeof data?.error?.retryable === "boolean"
            ? data.error.retryable
            : retryableProjectStatus(response.status),
        status: response.status,
      });

      const message = getApiErrorMessage(
        data,
        `Não foi possível carregar o projeto ${projectSlug}.`,
      );

      throw new Error(message);
    }

    const projectId = data?.project?.id ?? null;
    const revisionValue =
      data?.lifecycle?.configRevision ??
      data?.project?.lifecycle?.configRevision ??
      data?.project?.configRevision ??
      null;
    const schemaVersionValue =
      data?.lifecycle?.schema?.version ??
      data?.project?.lifecycle?.schema?.version ??
      null;
    const revision = Number.isFinite(Number(revisionValue))
      ? Number(revisionValue)
      : null;
    const schemaVersion = Number.isFinite(Number(schemaVersionValue))
      ? Number(schemaVersionValue)
      : null;
    const traceContext = {
      projectId,
      revision,
      schemaVersion,
    };

    updateActiveMapLoadTraceContext(traceContext);

    const savedConfig = data.config;
    validateSavedKeplerConfig(savedConfig);
    recordMapLoadEvent("CONFIG_VALIDATED", traceContext);

    if (sizeBytes >= LARGE_CONFIG_FAST_PATH_BYTES) {
      // Give the loading overlay one paint opportunity before the synchronous
      // Kepler hydration work begins. This does not change data semantics.
      await yieldToBrowser(signal);
    }

    const loadedConfig = loadSavedKeplerConfig(savedConfig, { sizeBytes });
    recordMapLoadEvent("ENGINE_HYDRATION_STARTED", traceContext);

    dispatch(
      addDataToMap({
        datasets: loadedConfig.datasets,
        config: loadedConfig.config,
        options: {
          // A saved project already carries its mapState. Recomputing bounds
          // over every feature is expensive for large GeoJSONs and redundant.
          centerMap: false,
          readOnly: readOnly,
        },
      }),
    );
  } finally {
    dispatch(setLoadingMapStatus(false));
  }
}

const MapUrlLoader = connectStore(
  ({
    isMapLoading,
    currentModal,
    dispatch,
  }: {
    isMapLoading: boolean;
    currentModal: unknown;
    dispatch: any;
  }) => {
    const { projectSlug } = useParams();
    const { context } = useMapPanel();
    const loadedProjectRef = useRef<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retryToken, setRetryToken] = useState(0);

    useEffect(() => {
      if (!isMapLoading || currentModal == null) {
        return;
      }

      dispatch(toggleModal(null));
    }, [currentModal, dispatch, isMapLoading]);

    useEffect(() => {
      if (!projectSlug) {
        loadedProjectRef.current = null;
        loadPointClusterState(undefined);
        return;
      }

      const contextKey = [
        projectSlug,
        context?.organization?.id ?? "none",
        context?.version ?? 0,
        context?.mode ?? "unknown",
        retryToken,
      ].join(":");

      if (loadedProjectRef.current === contextKey) {
        return;
      }

      const controller = new AbortController();

      loadedProjectRef.current = contextKey;
      setError(null);

      loadProjectConfig(
        projectSlug,
        dispatch,
        controller.signal,
        context?.mode === "viewer",
      ).catch((err) => {
        if (controller.signal.aborted) {
          return;
        }

        failActiveMapLoadTrace({
          stage: "CONFIG_VALIDATED",
          code: "MAP_CONFIG_LOAD_FAILED",
          category: "MAP_CONFIG",
          retryable: true,
          status: null,
        });
        loadedProjectRef.current = null;
        setError(
          err instanceof Error
            ? err.message
            : "Não foi possível carregar o projeto.",
        );
        dispatch(setLoadingMapStatus(false));
      });

      return () => {
        controller.abort();
      };
    }, [
      context?.mode,
      context?.organization?.id,
      context?.version,
      dispatch,
      projectSlug,
      retryToken,
    ]);

    if (error) {
      return (
        <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-4 bg-black/70 p-6 text-white">
          <div className="max-w-xl rounded-2xl border border-red-300/30 bg-red-950/80 p-6 shadow-2xl">
            <h2 className="text-xl font-semibold">Erro ao carregar o projeto</h2>
            <p className="mt-3 text-sm text-red-100">{error}</p>
            <button
              className="mt-5 rounded-lg bg-white px-4 py-2 font-semibold text-red-950"
              type="button"
              onClick={() => setRetryToken((current) => current + 1)}
            >
              Tentar novamente
            </button>
          </div>
        </div>
      );
    }

    return isMapLoading ? (
      <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-2 bg-black/50">
        <Spinner className="h-10 w-10 text-white" />
        <p className="animate-pulse text-white text-center">
          Os dados estão sendo carregados... <br /> Isso pode levar alguns
          segundos — logo tudo estará pronto para visualização.
        </p>
      </div>
    ) : null;
  },
);

export default MapUrlLoader;
