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
    if (
      !context ||
      (
        context.features.mapManagementHome &&
        context.features.mapPanelModes
      ) ||
      redirectedRef.current
    ) {
      return;
    }

    redirectedRef.current = true;
    const fallback = context.availablePanels.editor.allowed
      ? "edit"
      : "view";
    navigate(
      `/projects/${encodeURIComponent(projectSlug)}/${fallback}`,
      { replace: true },
    );
  }, [context, navigate, projectSlug]);

  if (loading || (!context && !error)) {
    return (
      <main className="maono-map-management is-loading" aria-busy="true">
        <div role="status">Carregando opções do mapa…</div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="maono-map-management">
        <section className="maono-map-management__error" role="alert">
          <h1>Não foi possível abrir o gerenciamento</h1>
          <p>{error.message}</p>
          <Link to="/projects">Voltar aos projetos</Link>
        </section>
      </main>
    );
  }

  if (!context) return null;

  return (
    <main className="maono-map-management">
      <header className="maono-map-management__header">
        <Link to="/projects">← Projetos</Link>
        <span>{context.organization?.name}</span>
      </header>

      <section className="maono-map-management__intro">
        <span>Gerenciar mapa</span>
        <h1>{context.project?.name}</h1>
        <p>
          {context.project?.description ||
            "Escolha como deseja abrir este projeto."}
        </p>
      </section>

      <section
        className="maono-map-management__options"
        aria-label="Modos disponíveis"
      >
        {context.availablePanels.viewer.allowed ? (
          <article>
            <span className="maono-map-management__icon" aria-hidden="true">
              ◉
            </span>
            <div>
              <h2>Visualizar</h2>
              <p>
                Consulte camadas e filtros. A visibilidade alterada neste
                modo é local e não pode ser salva.
              </p>
            </div>
            <Link
              to={`/projects/${encodeURIComponent(projectSlug)}/view`}
            >
              Abrir visualizador
            </Link>
          </article>
        ) : null}

        {context.availablePanels.editor.allowed ? (
          <article>
            <span className="maono-map-management__icon" aria-hidden="true">
              ✎
            </span>
            <div>
              <h2>Editar</h2>
              <p>
                Altere estilos, camadas e filtros e salve uma nova revisão
                do projeto.
              </p>
            </div>
            <Link
              className="is-primary"
              to={`/projects/${encodeURIComponent(projectSlug)}/edit`}
            >
              Abrir editor
            </Link>
          </article>
        ) : null}
      </section>

      {!context.availablePanels.editor.allowed ? (
        <p className="maono-map-management__permission-note">
          Sua conta possui acesso de visualização, mas não recebeu as
          capacidades necessárias para editar e salvar este mapa.
        </p>
      ) : null}
    </main>
  );
}
