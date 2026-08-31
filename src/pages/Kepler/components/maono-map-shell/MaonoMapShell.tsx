import type { ReactNode } from "react";

import type { MapRuntimeMode } from "../../map-panel/types";
import type { MaonoMapPanelTab } from "./map-shell-events";
import "./maono-map-tokens.css";
import "./maono-map-shell.css";
import "./maono-map-panel-readability.css";
import "./maono-map-layout-contract.css";

type MaonoMapShellProps = {
  children: ReactNode;
  sidebar: ReactNode;
  topbar: ReactNode;
  panelHost: ReactNode;
  mode: MapRuntimeMode;
  panelAvailable: boolean;
  panelOpen: boolean;
  activePanelTab: MaonoMapPanelTab;
  mapReady: boolean;
  mapLoading: boolean;
  basemapStyle: string | null;
  basemapVisible: boolean;
  mapStatePresent: boolean;
  mapStylePresent: boolean;
  mapViewport: string;
  engineStateKeys: string;
};

export default function MaonoMapShell({
  children,
  sidebar,
  topbar,
  panelHost,
  mode,
  panelAvailable,
  panelOpen,
  activePanelTab,
  mapReady,
  mapLoading,
  basemapStyle,
  basemapVisible,
  mapStatePresent,
  mapStylePresent,
  mapViewport,
  engineStateKeys,
}: MaonoMapShellProps) {
  return (
    <div
      className={[
        "maono-map-runtime",
        "maono-map-shell",
        panelAvailable
          ? "maono-map-runtime--panel-available"
          : "maono-map-runtime--panel-unavailable",
        panelOpen
          ? "maono-map-runtime--panel-open"
          : "maono-map-runtime--panel-collapsed",
      ].join(" ")}
      data-map-mode={mode}
      data-panel-tab={activePanelTab}
      data-panel-open={panelOpen ? "true" : "false"}
      data-map-ready={mapReady ? "true" : "false"}
      data-map-loading={mapLoading ? "true" : "false"}
      data-basemap-style={basemapStyle ?? "unknown"}
      data-basemap-visible={basemapVisible ? "true" : "false"}
      data-map-state-present={mapStatePresent ? "true" : "false"}
      data-map-style-present={mapStylePresent ? "true" : "false"}
      data-map-viewport={mapViewport}
      data-engine-state-keys={engineStateKeys}
    >
      {sidebar}
      <section className="maono-map-runtime__workspace">
        {topbar}
        <div className="maono-map-runtime__map">{children}</div>
        {panelHost}
      </section>
    </div>
  );
}
