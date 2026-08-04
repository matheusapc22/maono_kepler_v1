import { Link } from "react-router";

import maonoSymbol from "../../../../assets/images/Logo_Simbolo.png";
import type { MapPanelContextValue } from "../../map-panel/types";
import MapShellIcon, {
  type MapShellIconName,
} from "./MapShellIcon";
import type { MaonoMapPanelTab } from "./map-shell-events";

type MapSidebarProps = {
  context: MapPanelContextValue;
  activePanelTab: MaonoMapPanelTab;
  panelOpen: boolean;
  layerPanelAvailable: boolean;
  loggingOut: boolean;
  onPanelTabSelect: (tab: MaonoMapPanelTab) => void;
  onOpenData: () => void;
  onLogout: () => Promise<void>;
};

type ModeNavigationItem = {
  key: "viewer" | "editor" | "create";
  label: string;
  icon: MapShellIconName;
  route: string;
};

function availableModeItems(
  context: MapPanelContextValue,
): ModeNavigationItem[] {
  const definitions: Array<
    Omit<ModeNavigationItem, "route">
  > = [
    { key: "viewer", label: "Visualizar", icon: "viewer" },
    { key: "editor", label: "Editar", icon: "editor" },
    { key: "create", label: "Criar", icon: "create" },
  ];

  return definitions.flatMap((definition) => {
    const availability = context.availablePanels[definition.key];

    if (!availability?.allowed || !availability.route) {
      return [];
    }

    return [{ ...definition, route: availability.route }];
  });
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
  activePanelTab,
  panelOpen,
  layerPanelAvailable,
  loggingOut,
  onPanelTabSelect,
  onOpenData,
  onLogout,
}: MapSidebarProps) {
  const capabilities = context.capabilities;
  const modeItems = availableModeItems(context);
  const canOpenLayers = Boolean(
    layerPanelAvailable &&
      capabilities.openLayerPanel &&
      capabilities.viewLayers,
  );
  const canOpenFilters = Boolean(
    layerPanelAvailable &&
      capabilities.openLayerPanel &&
      capabilities.viewFilters,
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
            className={
              panelOpen && activePanelTab === "layers" ? "is-active" : ""
            }
            onClick={() => onPanelTabSelect("layers")}
            aria-pressed={panelOpen && activePanelTab === "layers"}
            aria-controls="maono-map-engine-panel"
            aria-label="Camadas"
            title="Camadas"
          >
            <MapShellIcon name="layers" />
            <SidebarLabel>Camadas</SidebarLabel>
          </button>
        ) : null}

        {canOpenFilters ? (
          <button
            type="button"
            className={
              panelOpen && activePanelTab === "filters" ? "is-active" : ""
            }
            onClick={() => onPanelTabSelect("filters")}
            aria-pressed={panelOpen && activePanelTab === "filters"}
            aria-controls="maono-map-engine-panel"
            aria-label="Filtros"
            title="Filtros"
          >
            <MapShellIcon name="filters" />
            <SidebarLabel>Filtros</SidebarLabel>
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

        {modeItems.length > 0 ? (
          <span
            className="maono-map-sidebar__divider"
            aria-hidden="true"
          />
        ) : null}

        {modeItems.map((item) => (
          <Link
            key={item.key}
            to={item.route}
            className={context.mode === item.key ? "is-active" : ""}
            aria-current={context.mode === item.key ? "page" : undefined}
            aria-label={item.label}
            title={item.label}
          >
            <MapShellIcon name={item.icon} />
            <SidebarLabel>{item.label}</SidebarLabel>
          </Link>
        ))}

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
