import type { ReactNode } from "react";

import MapShellIcon from "./MapShellIcon";
import type { MaonoMapPanelTab } from "./map-shell-events";
import {
  maonoMapShellPanelControlId,
  maonoMapShellPanelLabel,
  type MaonoMapShellPanel,
} from "./map-shell-panels";

type MapPanelHostProps = {
  available: boolean;
  open: boolean;
  activePanel: MaonoMapShellPanel;
  activeLayerTab: MaonoMapPanelTab;
  children: ReactNode;
  onToggle: () => void;
  onClose: () => void;
};

export default function MapPanelHost({
  available,
  open,
  activePanel,
  activeLayerTab,
  children,
  onToggle,
  onClose,
}: MapPanelHostProps) {
  if (!available) {
    return null;
  }

  const activeLabel =
    activePanel === "layers" && activeLayerTab === "filters"
      ? "Filtros"
      : maonoMapShellPanelLabel(activePanel);
  const controlsId = maonoMapShellPanelControlId(activePanel);
  const actionLabel = open
    ? `Recolher painel de ${activeLabel.toLowerCase()}`
    : `Abrir painel de ${activeLabel.toLowerCase()}`;

  return (
    <div
      className="maono-map-panel-host"
      data-active-panel={activePanel}
      data-active-tab={activeLayerTab}
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
        aria-controls={controlsId}
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
