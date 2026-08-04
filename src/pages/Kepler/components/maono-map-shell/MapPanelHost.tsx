import type { ReactNode } from "react";

import MapShellIcon from "./MapShellIcon";
import type { MaonoMapPanelTab } from "./map-shell-events";

type MapPanelHostProps = {
  available: boolean;
  open: boolean;
  activeTab: MaonoMapPanelTab;
  children: ReactNode;
  onToggle: () => void;
  onClose: () => void;
};

export default function MapPanelHost({
  available,
  open,
  activeTab,
  children,
  onToggle,
  onClose,
}: MapPanelHostProps) {
  if (!available) {
    return null;
  }

  const activeLabel = activeTab === "filters" ? "Filtros" : "Camadas";
  const actionLabel = open
    ? `Recolher painel de ${activeLabel.toLowerCase()}`
    : `Abrir painel de ${activeLabel.toLowerCase()}`;

  return (
    <div
      className="maono-map-panel-host"
      data-active-tab={activeTab}
      data-panel-open={open ? "true" : "false"}
      data-maono-no-preview="true"
    >
      {open ? (
        <button
          type="button"
          className="maono-map-panel-host__backdrop"
          onClick={onClose}
          aria-label="Fechar painel do mapa"
          tabIndex={-1}
        />
      ) : null}

      <div
        className="maono-map-panel-host__panel"
        data-maono-layout-node="shell-panel"
        aria-hidden={!open}
      >
        {children}
      </div>

      <button
        type="button"
        className="maono-map-panel-host__handle"
        onClick={onToggle}
        aria-controls="maono-map-engine-panel"
        aria-expanded={open}
        aria-label={actionLabel}
        title={actionLabel}
      >
        <MapShellIcon name={open ? "chevron-left" : "chevron-right"} />
        <span className="maono-map-panel-host__label">{activeLabel}</span>
      </button>
    </div>
  );
}
