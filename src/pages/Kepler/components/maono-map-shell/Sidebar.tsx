import type { ReactNode } from "react";
import { Link } from "react-router";

import maonoSymbol from "../../../../assets/images/Logo_Simbolo.png";

export type MaonoSidebarPanel =
  | "layers"
  | "analytics"
  | "data"
  | "files"
  | "users"
  | "home"
  | "organizations";

export type MaonoSidebarTheme = "dark" | "light";

type IconName =
  | "layers"
  | "analytics"
  | "data"
  | "files"
  | "users"
  | "home"
  | "organizations"
  | "viewer"
  | "editor"
  | "theme"
  | "logout";

type SidebarProps = {
  activePanel: MaonoSidebarPanel;
  mode: string;
  viewerRoute: string | null;
  editorRoute: string | null;
  canOpenViewer: boolean;
  canOpenEditor: boolean;
  canOpenLayers: boolean;
  canManageData: boolean;
  canViewFiles: boolean;
  canViewUsers: boolean;
  showCeoPanel: boolean;
  theme: MaonoSidebarTheme;
  onPanelSelect: (panel: MaonoSidebarPanel) => void;
  onToggleTheme: () => void;
  onLogout: () => void;
};

function ShellIcon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    layers: (
      <>
        <path d="m12 2 9 5-9 5-9-5 9-5Z" />
        <path d="m3 12 9 5 9-5" />
        <path d="m3 17 9 5 9-5" />
      </>
    ),
    analytics: (
      <>
        <path d="M4 19V9" />
        <path d="M10 19V5" />
        <path d="M16 19v-7" />
        <path d="M22 19H2" />
      </>
    ),
    data: (
      <>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
        <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      </>
    ),
    files: (
      <>
        <path d="M4 3h10l6 6v12H4z" />
        <path d="M14 3v6h6" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-2a6 6 0 0 1 12 0v2" />
        <path d="M16 5a3 3 0 0 1 0 6" />
        <path d="M18 14a5 5 0 0 1 3 4.6V20" />
      </>
    ),
    home: (
      <>
        <path d="m3 11 9-8 9 8" />
        <path d="M5 10v11h14V10" />
        <path d="M9 21v-7h6v7" />
      </>
    ),
    organizations: (
      <>
        <path d="M4 21V8l8-5 8 5v13" />
        <path d="M2 21h20" />
        <path d="M8 10h2M14 10h2M8 14h2M14 14h2" />
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
    theme: (
      <>
        <path d="M12 3a9 9 0 1 0 9 9c0-.6-.1-1.2-.2-1.8A7 7 0 0 1 12 3Z" />
        <path d="M18.5 3.5v3M17 5h3" />
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

function ItemLabel({ children }: { children: ReactNode }) {
  return <span className="maono-map-sidebar__tooltip">{children}</span>;
}

export function Sidebar({
  activePanel,
  mode,
  viewerRoute,
  editorRoute,
  canOpenViewer,
  canOpenEditor,
  canOpenLayers,
  canManageData,
  canViewFiles,
  canViewUsers,
  showCeoPanel,
  theme,
  onPanelSelect,
  onToggleTheme,
  onLogout,
}: SidebarProps) {
  const mainItems: Array<{
    id: MaonoSidebarPanel;
    icon: IconName;
    label: string;
    enabled: boolean;
    detail?: string;
  }> = [
    {
      id: "layers",
      icon: "layers",
      label: "Camadas",
      enabled: canOpenLayers,
    },
    {
      id: "analytics",
      icon: "analytics",
      label: "Análises",
      enabled: false,
      detail: "Painel em migração",
    },
    {
      id: "data",
      icon: "data",
      label: "Gestão de dados",
      enabled: canManageData,
    },
    {
      id: "files",
      icon: "files",
      label: "Arquivos e documentos",
      enabled: canViewFiles,
    },
    {
      id: "users",
      icon: "users",
      label: "Usuários e acessos",
      enabled: canViewUsers,
    },
    {
      id: "home",
      icon: "home",
      label: "Início",
      enabled: true,
    },
  ];

  return (
    <aside
      className="maono-map-sidebar"
      aria-label="Navegação Maõno Maps"
      data-maono-no-preview="true"
    >
      <Link
        className="maono-map-sidebar__brand"
        to="/projects"
        title="Maõno Maps"
        aria-label="Maõno Maps - Projetos"
      >
        <img src={maonoSymbol} alt="" />
      </Link>

      <nav className="maono-map-sidebar__nav" aria-label="Ferramentas do mapa">
        {mainItems.map((item) => {
          const active = activePanel === item.id;
          const title = item.detail
            ? `${item.label} — ${item.detail}`
            : item.label;

          return (
            <button
              key={item.id}
              type="button"
              className={active ? "is-active" : ""}
              onClick={() => onPanelSelect(item.id)}
              disabled={!item.enabled}
              aria-disabled={!item.enabled}
              aria-pressed={active}
              title={title}
            >
              <ShellIcon name={item.icon} />
              <ItemLabel>{title}</ItemLabel>
            </button>
          );
        })}
      </nav>

      <nav
        className="maono-map-sidebar__modes"
        aria-label="Modos do projeto"
      >
        {viewerRoute && canOpenViewer ? (
          <Link
            to={viewerRoute}
            className={mode === "viewer" ? "is-active" : ""}
            title="Visualizar mapa"
            aria-label="Abrir modo de visualização"
          >
            <ShellIcon name="viewer" />
            <ItemLabel>Visualizar mapa</ItemLabel>
          </Link>
        ) : null}

        {editorRoute && canOpenEditor ? (
          <Link
            to={editorRoute}
            className={mode === "editor" ? "is-active" : ""}
            title="Editar mapa"
            aria-label="Abrir modo de edição"
          >
            <ShellIcon name="editor" />
            <ItemLabel>Editar mapa</ItemLabel>
          </Link>
        ) : null}
      </nav>

      <div className="maono-map-sidebar__footer">
        {showCeoPanel ? (
          <button
            type="button"
            className={activePanel === "organizations" ? "is-active" : ""}
            onClick={() => onPanelSelect("organizations")}
            title="Painel do CEO"
            aria-label="Abrir Painel do CEO"
          >
            <ShellIcon name="organizations" />
            <ItemLabel>Painel do CEO</ItemLabel>
          </button>
        ) : null}

        <button
          type="button"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
          aria-label={theme === "dark" ? "Usar tema claro" : "Usar tema escuro"}
        >
          <ShellIcon name="theme" />
          <ItemLabel>
            {theme === "dark" ? "Tema claro" : "Tema escuro"}
          </ItemLabel>
        </button>

        <button
          type="button"
          className="is-logout"
          onClick={onLogout}
          title="Sair"
          aria-label="Sair da Maõno"
        >
          <ShellIcon name="logout" />
          <ItemLabel>Sair</ItemLabel>
        </button>
      </div>
    </aside>
  );
}
