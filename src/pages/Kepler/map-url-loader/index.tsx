import { useEffect, useRef, useState } from "react";
import { connect } from "react-redux";
import { useParams } from "react-router";
import { loadFiles } from "@kepler.gl/actions";
import type { RootState } from "../../../store";
import { selectIsMapLoading } from "../reducers/selectors";
import { setLoadingMapStatus } from "../actions";
import Spinner from "../../../components/Spinner";

const mapStateToProps = (state: RootState) => ({
  isMapLoading: selectIsMapLoading(state),
});
const dispatchToProps = (dispatch: any) => ({ dispatch });

const connectStore = connect(mapStateToProps, dispatchToProps);

async function loadProjectConfig(projectSlug: string, dispatch: any) {
  dispatch(setLoadingMapStatus(true));

  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectSlug)}/config`,
    {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    }
  );

  const data = await response.json();

  if (!response.ok || !data?.ok) {
    const message =
      data?.error?.message ||
      `Não foi possível carregar o projeto ${projectSlug}.`;
    throw new Error(message);
  }

  const file = new File(
    [JSON.stringify(data.config, null, 2)],
    `${projectSlug}.kepler.json`,
    { type: "application/json" }
  );

  await dispatch(loadFiles([file]));
}

const MapUrlLoader = connectStore(
  ({ isMapLoading, dispatch }: { isMapLoading: boolean; dispatch: any }) => {
    const { projectSlug } = useParams();
    const loadedProjectRef = useRef<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      if (!projectSlug || loadedProjectRef.current === projectSlug) return;

      loadedProjectRef.current = projectSlug;
      setError(null);

      loadProjectConfig(projectSlug, dispatch)
        .catch((err) => {
          loadedProjectRef.current = null;
          setError(
            err instanceof Error
              ? err.message
              : "Não foi possível carregar o projeto."
          );
        })
        .finally(() => {
          dispatch(setLoadingMapStatus(false));
        });
    }, [projectSlug, dispatch]);

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
  }
);

export default MapUrlLoader;
