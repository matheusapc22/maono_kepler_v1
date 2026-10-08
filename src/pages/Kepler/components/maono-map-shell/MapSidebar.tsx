import type { MouseEventHandler } from "react";
import { Link } from "react-router";

import maonoSymbol from "../../../../assets/images/Logo_Simbolo.png";
import type { MapPanelContextValue } from "../../map-panel/types";
import MapShellIcon from "./MapShellIcon";
import type { MaonoMapPanelTab } from "./map-shell-events";
import type { MaonoMapShellPanel } from "./map-shell-panels";

type MapSidebarProps = {
  context: MapPanelContextValue;
  panelOpen: boolean;
  activePanel: MaonoMapShellPanel;
  layerPanelAvailable: boolean;
  basemapAvailable: boolean;
  mapLoading: boolean;
  loggingOut: boolean;
  onPanelTabSelect: (tab: MaonoMapPanelTab) => void;
  onOpenBasemap: () => void;
  onOpenData: () => void;
  onLogout: () => Promise<void>;
  onNavigateHome: MouseEventHandler<HTMLAnchorElement>;
};

/** One neutral outline replaces the straight rail edge beside the open tool. */
function SidebarConnector() {
  return (
    <svg
      className="maono-map-sidebar__connector"
      viewBox="0 0 80 72"
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path className="maono-map-sidebar__connector-fill" d="M79.5 0Q79.5 12 67.5 12H18Q4 12 4 26V46Q4 60 18 60H67.5Q79.5 60 79.5 72H81V0Z" />
      <path className="maono-map-sidebar__connector-edge" d="M79.5 0Q79.5 12 67.5 12H18Q4 12 4 26V46Q4 60 18 60H67.5Q79.5 60 79.5 72" />
    </svg>
  );
}

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
  activePanel,
  layerPanelAvailable,
  basemapAvailable,
  mapLoading,
  loggingOut,
  onPanelTabSelect,
  onOpenBasemap,
  onOpenData,
  onLogout,
  onNavigateHome,
}: MapSidebarProps) {
  const capabilities = context.capabilities;
  const canOpenLayers = Boolean(
    layerPanelAvailable &&
      capabilities.openLayerPanel &&
      capabilities.viewLayers,
  );
  const canOpenBasemap = Boolean(
    basemapAvailable && capabilities.viewMap,
  );
  const canImportData = capabilities.importData === true;
  const loadingTitle = "Disponível quando o mapa terminar de carregar.";

  return (
    <aside
      className="maono-map-sidebar"
      aria-label="Navegação Maõno Maps"
      data-maono-no-preview="true"
    >
      <Link
        className="maono-map-sidebar__brand"
        to="/projects"
        onClick={onNavigateHome}
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
            className={
              panelOpen && activePanel === "layers" ? "is-active" : ""
            }
            onClick={() => onPanelTabSelect("layers")}
            disabled={mapLoading}
            aria-pressed={panelOpen && activePanel === "layers"}
            aria-expanded={panelOpen && activePanel === "layers"}
            aria-controls="maono-map-engine-panel"
            aria-label="Camadas"
            title={mapLoading ? loadingTitle : "Camadas"}
          >
            {panelOpen && activePanel === "layers" ? <SidebarConnector /> : null}
            <MapShellIcon name="layers" />
            <SidebarLabel>Camadas</SidebarLabel>
          </button>
        ) : null}

        {canOpenBasemap ? (
          <button
            type="button"
            className={
              panelOpen && activePanel === "basemap" ? "is-active" : ""
            }
            onClick={onOpenBasemap}
            disabled={mapLoading}
            aria-pressed={panelOpen && activePanel === "basemap"}
            aria-expanded={panelOpen && activePanel === "basemap"}
            aria-controls="maono-basemap-panel"
            aria-label="Mapa base"
            title={mapLoading ? loadingTitle : "Mapa base"}
          >
            {panelOpen && activePanel === "basemap" ? <SidebarConnector /> : null}
            <MapShellIcon name="basemap" />
            <SidebarLabel>Mapa base</SidebarLabel>
          </button>
        ) : null}

        <button
          type="button"
          className="maono-map-sidebar__saved-searches"
          disabled
          aria-label="Pesquisas salvas"
          title="Pesquisas salvas — em breve"
        >
          <MapShellIcon name="projects" />
          <SidebarLabel>Pesquisas salvas — em breve</SidebarLabel>
        </button>

        {canImportData ? (
          <button
            type="button"
            className={panelOpen && activePanel === "data" ? "is-active" : ""}
            aria-expanded={panelOpen && activePanel === "data"}
            aria-pressed={panelOpen && activePanel === "data"}
            aria-controls="map-add-data-sidebar"
            onClick={onOpenData}
            disabled={mapLoading}
            aria-label="Adicionar dados"
            title={mapLoading ? loadingTitle : "Adicionar dados"}
          >
            {panelOpen && activePanel === "data" ? <SidebarConnector /> : null}
            <MapShellIcon name="data" />
            <SidebarLabel>Adicionar dados</SidebarLabel>
          </button>
        ) : null}

        <Link
          to="/projects"
          onClick={onNavigateHome}
          aria-label="Voltar ao início"
          title="Início"
        >
          <MapShellIcon name="home" />
          <SidebarLabel>Início</SidebarLabel>
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
