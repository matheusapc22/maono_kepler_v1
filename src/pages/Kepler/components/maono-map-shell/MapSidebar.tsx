import { Link } from "react-router";

import maonoSymbol from "../../../../assets/images/Logo_Simbolo.png";
import type { MapPanelContextValue } from "../../map-panel/types";
import MapShellIcon from "./MapShellIcon";
import type { MaonoMapPanelTab } from "./map-shell-events";

type MapSidebarProps = {
  context: MapPanelContextValue;
  panelOpen: boolean;
  layerPanelAvailable: boolean;
  loggingOut: boolean;
  onPanelTabSelect: (tab: MaonoMapPanelTab) => void;
  onOpenData: () => void;
  onLogout: () => Promise<void>;
};

function SidebarLabel({ children }: { children: string }) {
  return (
    <span className="maono-map-sidebar__tooltip" role="tooltip">
      {children}
    </span>
  );
}

export default function MapSidebar({
  context,
  panelOpen,
  layerPanelAvailable,
  loggingOut,
  onPanelTabSelect,
  onOpenData,
  onLogout,
}: MapSidebarProps) {
  const capabilities = context.capabilities;
  const canOpenLayers = Boolean(
    layerPanelAvailable &&
      capabilities.openLayerPanel &&
      capabilities.viewLayers,
  );
  const canImportData = capabilities.createLayer === true;

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
        aria-label="Maõno Maps — Projetos"
      >
        <img src={maonoSymbol} alt="" />
      </Link>

      <nav
        className="maono-map-sidebar__nav"
        aria-label="Ferramentas do mapa"
      >
        {canOpenLayers ? (
          <button
            type="button"
            className={panelOpen ? "is-active" : ""}
            onClick={() => onPanelTabSelect("layers")}
            aria-pressed={panelOpen}
            aria-controls="maono-map-engine-panel"
            aria-label="Camadas"
            title="Camadas"
          >
            <MapShellIcon name="layers" />
            <SidebarLabel>Camadas</SidebarLabel>
          </button>
        ) : null}

        {canImportData ? (
          <button
            type="button"
            onClick={onOpenData}
            aria-label="Adicionar dados"
            title="Adicionar dados"
          >
            <MapShellIcon name="data" />
            <SidebarLabel>Adicionar dados</SidebarLabel>
          </button>
        ) : null}

        <Link
          to="/projects"
          aria-label="Voltar aos projetos"
          title="Projetos"
        >
          <MapShellIcon name="projects" />
          <SidebarLabel>Projetos</SidebarLabel>
        </Link>
      </nav>

      <button
        type="button"
        className="maono-map-sidebar__logout"
        onClick={() => void onLogout()}
        disabled={loggingOut}
        aria-label={loggingOut ? "Encerrando sessão" : "Sair da Maõno"}
        title={loggingOut ? "Encerrando sessão" : "Sair"}
      >
        <MapShellIcon name="logout" />
        <SidebarLabel>{loggingOut ? "Saindo…" : "Sair"}</SidebarLabel>
      </button>
    </aside>
  );
}
