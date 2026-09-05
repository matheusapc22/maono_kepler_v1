import { useEffect, useRef, useState } from "react";
import { connect, useStore } from "react-redux";
import { useParams } from "react-router";
import { addDataToMap, removeDataset, toggleModal } from "@kepler.gl/actions";
import { selectIsMapLoading } from "../reducers/selectors";
import { setLoadingMapStatus } from "../actions";
import Spinner from "../../../components/Spinner";
import { isPointClusteringFeatureEnabled } from "../clustering/point-cluster-policy.ts";
import { loadPointClusterState } from "../clustering/point-cluster-store.ts";
import { getProjectChangeReview } from "../change-requests/review-api";
import { useMapPanel } from "../map-panel/MapPanelContext";
import {
  failActiveMapLoadTrace,
  getActiveMapLoadTrace,
  recordActiveMapLoadTransportAttempt,
  recordMapLoadEvent,
  updateActiveMapLoadTraceContext,
} from "../observability/map-load-trace";
import {
  expectedDatasetIdsFromRuntimeDatasets,
  expectedLayerIdsFromRuntimeConfig,
  isMapVisualReadinessError,
  waitForMaonoMapVisualReadiness,
} from "./map-visual-readiness.ts";
import {
  isMapConfigStreamError,
  loadProjectConfigStream,
} from "./project-config-stream-client.ts";
import {
  hydrateSavedKeplerConfig,
  isSavedConfigHydrationError,
  validateSavedKeplerConfig,
} from "./saved-config-hydrator.ts";
import "./map-visual-readiness.css";

const POINT_CLUSTERING_FEATURE_ENABLED =
  isPointClusteringFeatureEnabled(
    import.meta.env.VITE_POINT_CLUSTERING_V1,
  );

const LARGE_CONFIG_UI_YIELD_BYTES = 10 * 1024 * 1024;

const mapStateToProps = (state: any) => ({
  isMapLoading: selectIsMapLoading(state),
  currentModal:
    state?.demo?.keplerGl?.map?.uiState?.currentModal ?? null,
});

const dispatchToProps = (dispatch: any) => ({ dispatch });
const connectStore = connect(mapStateToProps, dispatchToProps);

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

function currentDatasetIds(store: { getState: () => unknown }) {
  const datasets = (store.getState() as any)?.demo?.keplerGl?.map?.visState?.datasets;
  if (!datasets) return [] as string[];

  const keySeq = datasets?.keySeq?.();
  if (typeof keySeq?.toArray === "function") {
    return keySeq.toArray().map(String).filter(Boolean);
  }
  if (datasets instanceof Map) {
    return Array.from(datasets.keys()).map(String).filter(Boolean);
  }
  if (typeof datasets === "object") {
    return Object.keys(datasets);
  }
  return [] as string[];
}

function releaseKeplerDatasets(
  store: { getState: () => unknown },
  dispatch: any,
) {
  for (const datasetId of currentDatasetIds(store)) {
    dispatch(removeDataset(datasetId));
  }
}

function throwIfLoadAborted(signal: AbortSignal) {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Aborted", "AbortError");
}

async function loadReviewBaseProjectConfig(
  projectSlug: string,
  changeRequestId: string,
  signal: AbortSignal,
) {
  const review = await getProjectChangeReview(projectSlug, changeRequestId);
  throwIfLoadAborted(signal);
  if (String(review.project.slug) !== String(projectSlug)) {
    throw new Error("A revisão solicitada não pertence a este projeto.");
  }
  const serialized = JSON.stringify(review.base.config);
  const fallbackSizeBytes = new TextEncoder().encode(serialized).byteLength;
  return {
    projectId: review.project.id,
    revision: review.base.revision,
    schemaVersion:
      review.base.schemaVersion ?? review.proposal?.schemaVersion ?? 1,
    sizeBytes: review.base.sizeBytes ?? fallbackSizeBytes,
    config: review.base.config,
  };
}

async function loadProjectConfig(
  projectSlug: string,
  changeRequestId: string | undefined,
  dispatch: any,
  store: {
    getState: () => unknown;
    subscribe: (listener: () => void) => () => void;
  },
  signal: AbortSignal,
  readOnly: boolean,
) {
  dispatch(toggleModal(null));
  dispatch(setLoadingMapStatus(true));

  try {
    const activeTrace = getActiveMapLoadTrace();
    recordMapLoadEvent("CONFIG_REQUESTED");
    const loaded = changeRequestId
      ? await loadReviewBaseProjectConfig(projectSlug, changeRequestId, signal)
      : await loadProjectConfigStream(projectSlug, signal, {
          correlationId: activeTrace?.correlationId ?? null,
          onAttempt: recordActiveMapLoadTransportAttempt,
        });

    const traceContext = {
      projectId: loaded.projectId,
      revision: loaded.revision,
      schemaVersion: loaded.schemaVersion,
    };
    updateActiveMapLoadTraceContext(traceContext);

    const savedConfig = loaded.config;
    validateSavedKeplerConfig(savedConfig);
    recordMapLoadEvent("CONFIG_VALIDATED", traceContext);

    if (loaded.sizeBytes >= LARGE_CONFIG_UI_YIELD_BYTES) {
      await yieldToBrowser(signal);
    }

    const loadedConfig = hydrateSavedKeplerConfig(savedConfig, {
      featureEnabled: POINT_CLUSTERING_FEATURE_ENABLED,
    });
    const expectedLayerIds = expectedLayerIdsFromRuntimeConfig(
      loadedConfig.config,
    );
    const expectedDatasetIds = expectedDatasetIdsFromRuntimeDatasets(
      loadedConfig.datasets,
    );

    recordMapLoadEvent("MIGRATED", traceContext);
    recordMapLoadEvent("ENGINE_HYDRATION_STARTED", traceContext);

    releaseKeplerDatasets(store, dispatch);
    throwIfLoadAborted(signal);

    dispatch(
      addDataToMap({
        datasets: loadedConfig.datasets,
        config: loadedConfig.config,
        options: {
          centerMap: false,
          readOnly: readOnly,
        },
      }),
    );

    await waitForMaonoMapVisualReadiness({
      store,
      expectedLayerIds,
      expectedDatasetIds,
      signal,
    });
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
    const { projectSlug, changeRequestId } = useParams<{
      projectSlug?: string;
      changeRequestId?: string;
    }>();
    const { context } = useMapPanel();
    const store = useStore();
    const loadedProjectRef = useRef<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [retryToken, setRetryToken] = useState(0);

    useEffect(() => {
      if (!isMapLoading || currentModal == null) return;
      dispatch(toggleModal(null));
    }, [currentModal, dispatch, isMapLoading]);

    useEffect(() => {
      if (!projectSlug) {
        loadedProjectRef.current = null;
        releaseKeplerDatasets(store, dispatch);
        loadPointClusterState(undefined);
        return;
      }

      const contextKey = [
        projectSlug,
        changeRequestId ?? "head",
        context?.organization?.id ?? "none",
        context?.version ?? 0,
        context?.mode ?? "unknown",
        retryToken,
      ].join(":");

      if (loadedProjectRef.current === contextKey) return;

      const controller = new AbortController();
      loadedProjectRef.current = contextKey;
      setError(null);

      loadProjectConfig(
        projectSlug,
        changeRequestId,
        dispatch,
        store,
        controller.signal,
        context?.mode === "viewer" || Boolean(changeRequestId),
      ).catch((err) => {
        if (controller.signal.aborted) return;

        const visualReadinessFailure = isMapVisualReadinessError(err);
        const hydrationFailure = isSavedConfigHydrationError(err);
        const transportFailure = isMapConfigStreamError(err);
        failActiveMapLoadTrace({
          stage: visualReadinessFailure ? "MAP_READY" : "CONFIG_VALIDATED",
          code: visualReadinessFailure
            ? err.code
            : hydrationFailure
              ? err.code
              : transportFailure
                ? err.code
                : "MAP_CONFIG_CLIENT_PARSE_FAILED",
          category: visualReadinessFailure
            ? err.category
            : hydrationFailure
              ? err.category
              : transportFailure
                ? err.category
                : "MAP_CONFIG",
          retryable: visualReadinessFailure
            ? err.retryable
            : hydrationFailure
              ? err.retryable
              : transportFailure
                ? err.retryable
                : false,
          status: transportFailure ? err.status : null,
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
        controller.abort(
          new DOMException("Carregamento cancelado pela navegação.", "AbortError"),
        );
        releaseKeplerDatasets(store, dispatch);
        loadPointClusterState(undefined);
      };
    }, [
      changeRequestId,
      context?.mode,
      context?.organization?.id,
      context?.version,
      dispatch,
      projectSlug,
      retryToken,
      store,
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
      <div
        className="maono-map-central-loading fixed inset-0 z-[9999] flex flex-col items-center justify-center gap-2 bg-black/50"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
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
