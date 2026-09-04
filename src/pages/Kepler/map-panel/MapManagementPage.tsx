import {
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Link,
  useNavigate,
  useParams,
} from "react-router";

import { useSession } from "../../../auth/session";
import { fetchProjectMapNavigation } from "./map-panel-api";
import type {
  MapPanelApiError,
  MapPanelContextValue,
} from "./types";
import "./map-management-page.css";

function MapRedirectLoader() {
  return (
    <main className="maono-map-management is-loading" aria-busy="true">
      <span
        className="maono-map-management__spinner"
        aria-hidden="true"
      />
      <span className="maono-map-management__sr-only" role="status">
        Abrindo mapa.
      </span>
    </main>
  );
}

export default function MapManagementPage() {
  const { projectSlug = "" } = useParams();
  const navigate = useNavigate();
  const {
    authenticated,
    loading,
    activeOrganization,
    user,
  } = useSession();
  const [context, setContext] =
    useState<MapPanelContextValue | null>(null);
  const [error, setError] =
    useState<MapPanelApiError | null>(null);
  const redirectedRef = useRef(false);
  const organizationKey = String(
    activeOrganization?.id ??
      user?.activeOrganizationId ??
      user?.organizationId ??
      "none",
  );

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

    const controller = new AbortController();
    setContext(null);
    setError(null);
    redirectedRef.current = false;

    fetchProjectMapNavigation(
      projectSlug,
      "manage",
      controller.signal,
    )
      .then((value) => {
        if (!controller.signal.aborted) setContext(value);
      })
      .catch((nextError: MapPanelApiError) => {
        if (!controller.signal.aborted) setError(nextError);
      });

    return () => controller.abort();
  }, [authenticated, organizationKey, projectSlug]);

  useEffect(() => {
    if (!context || redirectedRef.current) return;

    const destination =
      context.defaultPanel === "editor" || context.defaultPanel === "viewer"
        ? context.defaultPanel === "editor"
          ? "edit"
          : "view"
        : null;

    if (!destination) return;

    redirectedRef.current = true;
    navigate(
      `/projects/${encodeURIComponent(projectSlug)}/${destination}`,
      { replace: true },
    );
  }, [context, navigate, projectSlug]);

  if (error) {
    return (
      <main className="maono-map-management">
        <section className="maono-map-management__error" role="alert">
          <h1>Não foi possível abrir o mapa</h1>
          <p>{error.message}</p>
          <Link to="/projects">Voltar aos projetos</Link>
        </section>
      </main>
    );
  }

  if (
    context &&
    !context.availablePanels.editor.allowed &&
    !context.availablePanels.viewer.allowed
  ) {
    return (
      <main className="maono-map-management">
        <section className="maono-map-management__error" role="alert">
          <h1>Mapa indisponível</h1>
          <p>Sua conta não recebeu acesso para abrir este projeto.</p>
          <Link to="/projects">Voltar aos projetos</Link>
        </section>
      </main>
    );
  }

  return <MapRedirectLoader />;
}