import { useEffect, useRef, useState } from "react";
import { connect } from "react-redux";
import { useParams } from "react-router";
import { addDataToMap } from "@kepler.gl/actions";
import KeplerGlSchema from "@kepler.gl/schemas";
import { selectIsMapLoading } from "../reducers/selectors";
import { setLoadingMapStatus } from "../actions";
import Spinner from "../../../components/Spinner";
import { prepareSavedConfigForPointClustering } from "../clustering/point-cluster-controller.ts";
import { isPointClusteringFeatureEnabled } from "../clustering/point-cluster-policy.ts";
import { loadPointClusterState } from "../clustering/point-cluster-store.ts";
import { useMapPanel } from "../map-panel/MapPanelContext";

const POINT_CLUSTERING_FEATURE_ENABLED =
  isPointClusteringFeatureEnabled(
    import.meta.env.VITE_POINT_CLUSTERING_V1,
  );

const mapStateToProps = (state: any) => ({
  isMapLoading: selectIsMapLoading(state),
});

const dispatchToProps = (dispatch: any) => ({ dispatch });

const connectStore = connect(mapStateToProps, dispatchToProps);

async function parseJsonResponse(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    throw new Error("A resposta do servidor veio vazia.");
  }

  try {
    return JSON.parse(text);
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

export function loadSavedKeplerConfig(savedConfig: any) {
  validateSavedKeplerConfig(savedConfig);

  const prepared = prepareSavedConfigForPointClustering(
    savedConfig,
    {
      featureEnabled: POINT_CLUSTERING_FEATURE_ENABLED,
    },
  );
  loadPointClusterState(
    savedConfig.maono,
    prepared.pairs,
  );

  try {
    const loaded = KeplerGlSchema.load(
      prepared.savedConfig,
    ) as any;

    if (isRecord(loaded)) {
      const datasets = Array.isArray(loaded.datasets)
        ? loaded.datasets
        : savedConfig.datasets.map(normalizeDatasetForKepler);

      const config =
        loaded.config ?? prepared.savedConfig.config;

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

  return {
    datasets: savedConfig.datasets.map(normalizeDatasetForKepler),
    config: prepared.savedConfig.config,
  };
}

async function loadProjectConfig(
  projectSlug: string,
  dispatch: any,
  signal: AbortSignal,
  readOnly: boolean,
) {
  dispatch(setLoadingMapStatus(true));

  try {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectSlug)}/config`,
      {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "application/json",
        },
        signal,
      },
    );

    const data = await parseJsonResponse(response);

    if (!response.ok || !data?.ok) {
      const message = getApiErrorMessage(
        data,
        `Não foi possível carregar o projeto ${projectSlug}.`,
      );

      throw new Error(message);
    }

    const savedConfig = data.config;
    const loadedConfig = loadSavedKeplerConfig(savedConfig);

    dispatch(
      addDataToMap({
        datasets: loadedConfig.datasets,
        config: loadedConfig.config,
        options: {
          centerMap: true,
          readOnly: readOnly,
        },
      }),
    );
  } finally {
    dispatch(setLoadingMapStatus(false));
  }
}

const MapUrlLoader = connectStore(
  ({ isMapLoading, dispatch }: { isMapLoading: boolean; dispatch: any }) => {
    const { projectSlug } = useParams();
    const { context } = useMapPanel();
    const loadedProjectRef = useRef<string | null>(null);
    const [error, setError] = useState<string | null>(null);

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
              onClick={() => window.location.reload()}
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
