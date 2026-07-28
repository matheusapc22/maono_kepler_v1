import {
  type ReactNode,
  useMemo,
  useState,
} from "react";
import {
  Link,
  useNavigate,
} from "react-router";

import maonoSymbol from "../../../../assets/images/Logo_Simbolo.png";
import { useSession } from "../../../../auth/session";
import { useMapPanel } from "../../map-panel/MapPanelContext";
import "./maono-map-shell.css";

type IconName =
  | "layers"
  | "projects"
  | "viewer"
  | "editor"
  | "logout";

function ShellIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    layers: (
      <>
        <path d="m12 2 9 5-9 5-9-5 9-5Z" />
        <path d="m3 12 9 5 9-5" />
        <path d="m3 17 9 5 9-5" />
      </>
    ),
    projects: (
      <>
        <path d="M3 7h7l2 2h9v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
        <path d="M3 7V5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2" />
      </>
    ),
    viewer: (
      <>
        <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" />
        <circle cx="12" cy="12" r="2.7" />
      </>
    ),
    editor: (
      <>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5Z" />
      </>
    ),
    logout: (
      <>
        <path d="M10 17l5-5-5-5" />
        <path d="M15 12H3" />
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}

function userInitials(name?: string, email?: string) {
  const source = String(name || email || "Maõno").trim();
  const parts = source.split(/\s+/).filter(Boolean);

  return (
    parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`
      : source.slice(0, 2)
  ).toUpperCase();
}

export default function MaonoMapShell({
  children,
}: {
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const {
    activeOrganization,
    logout,
    user,
  } = useSession();
  const {
    context,
    customLayerPanelEnabled,
    customMapShellEnabled,
  } = useMapPanel();
  const [panelOpen, setPanelOpen] = useState(true);
  const initials = useMemo(
    () => userInitials(user?.name, user?.email),
    [user?.email, user?.name],
  );

  if (!customMapShellEnabled) {
    return <>{children}</>;
  }

  const projectSlug = context?.project?.slug;
  const viewerRoute =
    context?.availablePanels?.viewer?.route ||
    (projectSlug
      ? `/projects/${encodeURIComponent(projectSlug)}/view`
      : null);
  const editorRoute =
    context?.availablePanels?.editor?.route ||
    (projectSlug
      ? `/projects/${encodeURIComponent(projectSlug)}/edit`
      : null);
  const canTogglePanel = Boolean(
    customLayerPanelEnabled &&
      context?.capabilities?.openLayerPanel,
  );

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div
      className={[
        "maono-map-shell",
        panelOpen
          ? "maono-map-shell--panel-open"
          : "maono-map-shell--panel-collapsed",
      ].join(" ")}
      data-map-mode={context?.mode || "viewer"}
    >
      <aside
        className="maono-map-shell__sidebar"
        aria-label="Navegação Maõno Maps"
        data-maono-no-preview="true"
      >
        <Link
          className="maono-map-shell__brand"
          to="/projects"
          title="Maõno Maps"
          aria-label="Maõno Maps - Projetos"
        >
          <img src={maonoSymbol} alt="" />
        </Link>

        <nav className="maono-map-shell__nav">
          <button
            type="button"
            className={panelOpen ? "is-active" : ""}
            onClick={() => setPanelOpen((current) => !current)}
            disabled={!canTogglePanel}
            title="Camadas e filtros"
            aria-label="Abrir ou recolher camadas e filtros"
          >
            <ShellIcon name="layers" />
            <span>Camadas</span>
          </button>

          {viewerRoute &&
          context?.availablePanels?.viewer?.allowed ? (
            <Link
              to={viewerRoute}
              className={
                context?.mode === "viewer" ? "is-active" : ""
              }
              title="Modo visualizador"
              aria-label="Abrir modo visualizador"
            >
              <ShellIcon name="viewer" />
              <span>Visualizar</span>
            </Link>
          ) : null}

          {editorRoute &&
          context?.availablePanels?.editor?.allowed ? (
            <Link
              to={editorRoute}
              className={
                context?.mode === "editor" ? "is-active" : ""
              }
              title="Modo editor"
              aria-label="Abrir modo editor"
            >
              <ShellIcon name="editor" />
              <span>Editar</span>
            </Link>
          ) : null}

          <Link
            to="/projects"
            title="Voltar aos projetos"
            aria-label="Voltar aos projetos"
          >
            <ShellIcon name="projects" />
            <span>Projetos</span>
          </Link>
        </nav>

        <button
          type="button"
          className="maono-map-shell__logout"
          onClick={() => void handleLogout()}
          title="Sair"
          aria-label="Sair da Maõno"
        >
          <ShellIcon name="logout" />
          <span>Sair</span>
        </button>
      </aside>

      <section className="maono-map-shell__workspace">
        <header
          className="maono-map-shell__topbar"
          data-maono-no-preview="true"
        >
          <div className="maono-map-shell__project">
            <span>
              {activeOrganization?.name ||
                context?.organization?.name ||
                "Maõno Maps"}
            </span>
            <strong>
              {context?.project?.name ||
                (projectSlug ? "Mapa do projeto" : "Novo mapa")}
            </strong>
          </div>

          <div className="maono-map-shell__account">
            <span className="maono-map-shell__mode">
              {context?.mode === "editor"
                ? "Editor"
                : "Visualizador"}
            </span>
            <div className="maono-map-shell__avatar" aria-hidden="true">
              {initials}
            </div>
            <div className="maono-map-shell__identity">
              <strong>{user?.name || "Usuário Maõno"}</strong>
              <span>{user?.email}</span>
            </div>
          </div>
        </header>

        <div className="maono-map-shell__map">{children}</div>

        {canTogglePanel ? (
          <button
            type="button"
            className="maono-map-shell__panel-handle"
            onClick={() => setPanelOpen((current) => !current)}
            data-maono-no-preview="true"
            title={panelOpen ? "Recolher painel" : "Abrir painel"}
            aria-label={panelOpen ? "Recolher painel" : "Abrir painel"}
          >
            <span aria-hidden="true">
              {panelOpen ? "‹" : "›"}
            </span>
          </button>
        ) : null}
      </section>
    </div>
  );
}
