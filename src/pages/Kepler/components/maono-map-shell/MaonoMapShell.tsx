import {
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toggleModal, wrapTo } from "@kepler.gl/actions";
import { useDispatch } from "react-redux";
import { useNavigate } from "react-router";

import { can } from "../../../../access-control/can";
import { PERMISSION } from "../../../../access-control/permissions";
import { normalizeRole } from "../../../../access-control/roles";
import { useSession } from "../../../../auth/session";
import {
  Sidebar,
  type MaonoSidebarPanel,
  type MaonoSidebarTheme,
} from "./Sidebar";
import "./maono-map-shell.css";

const KEPLER_ID = "map";
const THEME_STORAGE_KEY = "maono-map-shell-theme";

type MapShellRuntime = {
  context: {
    mode?: string;
    project?: {
      slug?: string;
      name?: string;
    } | null;
    organization?: {
      name?: string;
    } | null;
    availablePanels?: {
      viewer?: {
        route?: string | null;
        allowed?: boolean;
      };
      editor?: {
        route?: string | null;
        allowed?: boolean;
      };
    };
    capabilities?: {
      viewLayers?: boolean;
      openLayerPanel?: boolean;
      createLayer?: boolean;
      editLayers?: boolean;
    };
  } | null;
  customMapShellEnabled: boolean;
};

function readInitialTheme(): MaonoSidebarTheme {
  if (typeof window === "undefined") return "dark";

  return window.localStorage.getItem(THEME_STORAGE_KEY) === "light"
    ? "light"
    : "dark";
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

function modeLabel(mode?: string) {
  if (mode === "editor") return "Editor";
  if (mode === "create") return "Criação";
  if (mode === "manage") return "Gestão";
  return "Visualizador";
}

export default function MaonoMapShell({
  children,
  runtime,
}: {
  children: ReactNode;
  runtime: MapShellRuntime;
}) {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const {
    activeOrganization,
    logout,
    user,
  } = useSession();
  const {
    context,
    customMapShellEnabled,
  } = runtime;
  const [activePanel, setActivePanel] =
    useState<MaonoSidebarPanel>("layers");
  const [panelOpen, setPanelOpen] = useState(true);
  const [theme, setTheme] = useState<MaonoSidebarTheme>(readInitialTheme);

  const initials = useMemo(
    () => userInitials(user?.name, user?.email),
    [user?.email, user?.name],
  );

  const organizationPermissionContext = useMemo(
    () => ({
      organizationId:
        activeOrganization?.id ??
        user?.activeOrganizationId ??
        user?.organizationId ??
        user?.organization_id ??
        undefined,
      organization: activeOrganization ?? undefined,
      permissions: user?.permissions,
      scopes: user?.scopes,
    }),
    [activeOrganization, user],
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  }, [theme]);

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

  const canOpenLayers = Boolean(
    context?.capabilities?.viewLayers &&
      context?.capabilities?.openLayerPanel,
  );
  const canManageData = Boolean(
    context?.mode !== "viewer" &&
      (context?.capabilities?.createLayer ||
        context?.capabilities?.editLayers),
  );
  const canViewFiles = can(
    user as never,
    PERMISSION.DOCUMENT_VIEW,
    organizationPermissionContext,
  );
  const canViewUsers = can(
    user as never,
    PERMISSION.USERS_VIEW,
    organizationPermissionContext,
  );
  const showCeoPanel = normalizeRole(user?.role) === "super_admin";

  function handlePanelSelect(panel: MaonoSidebarPanel) {
    setActivePanel(panel);

    if (panel === "layers") {
      setPanelOpen((current) => !current);
      return;
    }

    if (panel === "data" && canManageData) {
      dispatch(wrapTo(KEPLER_ID, toggleModal("addData")));
      return;
    }

    if (panel === "files") {
      navigate("/projects?section=files");
      return;
    }

    if (panel === "users") {
      navigate("/projects?section=users");
      return;
    }

    if (panel === "organizations") {
      navigate("/admin?section=organizations");
      return;
    }

    if (panel === "home") {
      navigate("/projects?section=all");
    }
  }

  function handleToggleTheme() {
    setTheme((current) => (current === "dark" ? "light" : "dark"));
  }

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div
      className={[
        "maono-map-shell",
        `maono-map-shell--${theme}`,
        panelOpen
          ? "maono-map-shell--panel-open"
          : "maono-map-shell--panel-collapsed",
      ].join(" ")}
      data-map-mode={context?.mode || "viewer"}
    >
      <Sidebar
        activePanel={activePanel}
        mode={context?.mode || "viewer"}
        viewerRoute={viewerRoute}
        editorRoute={editorRoute}
        canOpenViewer={Boolean(
          context?.availablePanels?.viewer?.allowed,
        )}
        canOpenEditor={Boolean(
          context?.availablePanels?.editor?.allowed,
        )}
        canOpenLayers={canOpenLayers}
        canManageData={canManageData}
        canViewFiles={canViewFiles}
        canViewUsers={canViewUsers}
        showCeoPanel={showCeoPanel}
        theme={theme}
        onPanelSelect={handlePanelSelect}
        onToggleTheme={handleToggleTheme}
        onLogout={() => void handleLogout()}
      />

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
              {modeLabel(context?.mode)}
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

        {canOpenLayers ? (
          <button
            type="button"
            className="maono-map-shell__panel-handle"
            onClick={() => setPanelOpen((current) => !current)}
            data-maono-no-preview="true"
            title={panelOpen ? "Recolher painel" : "Abrir painel"}
            aria-label={panelOpen ? "Recolher painel" : "Abrir painel"}
          >
            <span aria-hidden="true">{panelOpen ? "‹" : "›"}</span>
          </button>
        ) : null}
      </section>
    </div>
  );
}
