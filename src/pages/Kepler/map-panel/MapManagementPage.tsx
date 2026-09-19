import {
  useEffect,
  useState,
} from "react";
import {
  Link,
  useNavigate,
  useParams,
} from "react-router";

import { useSession } from "../../../auth/session";
import { useLoadingActivity } from "../../../components/loading";
import { usePreparedNavigate } from "../../../hooks/usePreparedNavigate";
import { normalizeUserError } from "../../../lib/user-error-catalog";
import { prepareProjectMapDestination } from "./prepare-project-map-destination";
import type { MapPanelApiError } from "./types";
import "./map-management-page.css";

export default function MapManagementPage() {
  const { projectSlug = "" } = useParams();
  const navigate = useNavigate();
  const {
    authenticated,
    loading,
  } = useSession();
  const { prepareNavigate } = usePreparedNavigate();
  const [error, setError] =
    useState<MapPanelApiError | null>(null);

  useLoadingActivity(loading);

  useEffect(() => {
    if (!loading && !authenticated) {
      navigate(
        `/login?next=${encodeURIComponent(
          `/projects/${projectSlug}/manage`,
        )}`,
        { replace: true },
      );
    }
  }, [authenticated, loading, navigate, projectSlug]);

  useEffect(() => {
    if (!authenticated || !projectSlug) return;

    let destination =
      `/projects/${encodeURIComponent(projectSlug)}/manage`;
    setError(null);

    void prepareNavigate({
      route: "kepler",
      to: () => destination,
      replace: true,
      beforeNavigate: async (signal) => {
        const prepared = await prepareProjectMapDestination(
          projectSlug,
          signal,
        );
        destination = prepared.pathname;
      },
    }).catch((nextError: MapPanelApiError) => {
      setError(nextError);
    });
  }, [authenticated, prepareNavigate, projectSlug]);

  if (error) {
    return (
      <main className="maono-map-management">
        <section className="maono-map-management__error" role="alert">
          <h1>Não foi possível abrir o mapa</h1>
          <p>{normalizeUserError(error).message}</p>
          <Link to="/projects">Voltar aos projetos</Link>
        </section>
      </main>
    );
  }

  return null;
}
