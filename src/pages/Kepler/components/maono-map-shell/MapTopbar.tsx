import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";

import type { useSession } from "../../../../auth/session";
import type { MapPanelContextValue } from "../../map-panel/types";
import MapShellIcon from "./MapShellIcon";

type SessionValue = ReturnType<typeof useSession>;

type MapTopbarProps = {
  context: MapPanelContextValue;
  activeOrganization: SessionValue["activeOrganization"];
  user: SessionValue["user"];
  mapReady: boolean;
  mapLoading: boolean;
  hasUnsavedChanges: boolean;
  loggingOut: boolean;
  onLogout: () => Promise<void>;
};

function userInitials(name?: string, email?: string) {
  const source = String(name || email || "Maõno").trim();
  const parts = source.split(/\s+/).filter(Boolean);

  return (
    parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`
      : source.slice(0, 2)
  ).toUpperCase();
}

function modeLabel(mode: MapPanelContextValue["mode"]) {
  if (mode === "editor") return "Editor";
  if (mode === "create") return "Criação";
  return "Visualizador";
}

function mapStatus({
  context,
  mapReady,
  mapLoading,
  hasUnsavedChanges,
}: Pick<
  MapTopbarProps,
  "context" | "mapReady" | "mapLoading" | "hasUnsavedChanges"
>) {
  if (mapLoading || !mapReady) {
    return {
      label: "Preparando mapa",
      tone: "loading",
    };
  }

  if (!context.capabilities.saveMap || context.mode === "viewer") {
    return {
      label: "Somente leitura",
      tone: "readonly",
    };
  }

  if (hasUnsavedChanges) {
    return {
      label: "Alterações não salvas",
      tone: "dirty",
    };
  }

  return {
    label: context.mode === "create" ? "Novo mapa" : "Sem alterações",
    tone: "clean",
  };
}

export default function MapTopbar({
  context,
  activeOrganization,
  user,
  mapReady,
  mapLoading,
  hasUnsavedChanges,
  loggingOut,
  onLogout,
}: MapTopbarProps) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement | null>(null);
  const initials = useMemo(
    () => userInitials(user?.name, user?.email),
    [user?.email, user?.name],
  );
  const status = mapStatus({
    context,
    mapReady,
    mapLoading,
    hasUnsavedChanges,
  });
  const organizationName =
    activeOrganization?.name ||
    context.organization?.name ||
    "Maõno Maps";
  const projectName =
    context.project?.name ||
    (context.mode === "create" ? "Novo mapa" : "Mapa do projeto");

  useEffect(() => {
    if (!accountMenuOpen) {
      return undefined;
    }

    function handlePointerDown(event: PointerEvent) {
      if (
        accountRef.current &&
        !accountRef.current.contains(event.target as Node)
      ) {
        setAccountMenuOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAccountMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [accountMenuOpen]);

  return (
    <header
      className="maono-map-topbar"
      data-maono-no-preview="true"
    >
      <div className="maono-map-topbar__project">
        <Link
          to="/projects"
          className="maono-map-topbar__back"
          aria-label="Voltar aos projetos"
          title="Voltar aos projetos"
        >
          <MapShellIcon name="chevron-left" />
        </Link>
        <div>
          <span>{organizationName}</span>
          <strong title={projectName}>{projectName}</strong>
        </div>
      </div>

      <div className="maono-map-topbar__account" ref={accountRef}>
        <span
          className={`maono-map-topbar__status is-${status.tone}`}
          role="status"
          aria-live="polite"
        >
          {status.label}
        </span>
        <span className="maono-map-topbar__mode">
          {modeLabel(context.mode)}
        </span>
        <button
          type="button"
          className="maono-map-topbar__account-trigger"
          onClick={() => setAccountMenuOpen((current) => !current)}
          aria-haspopup="menu"
          aria-expanded={accountMenuOpen}
          aria-controls="maono-map-account-menu"
        >
          <span className="maono-map-topbar__avatar" aria-hidden="true">
            {initials}
          </span>
          <span className="maono-map-topbar__identity">
            <strong>{user?.name || "Usuário Maõno"}</strong>
            <span>{user?.email || "Sessão autenticada"}</span>
          </span>
          <MapShellIcon
            name={accountMenuOpen ? "chevron-left" : "chevron-right"}
          />
        </button>

        {accountMenuOpen ? (
          <div
            id="maono-map-account-menu"
            className="maono-map-topbar__account-menu"
            role="menu"
          >
            <div>
              <strong>{user?.name || "Usuário Maõno"}</strong>
              <span>{user?.email}</span>
            </div>
            <Link to="/projects" role="menuitem">
              <MapShellIcon name="projects" />
              Projetos
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={() => void onLogout()}
              disabled={loggingOut}
            >
              <MapShellIcon name="logout" />
              {loggingOut ? "Encerrando sessão…" : "Sair"}
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
