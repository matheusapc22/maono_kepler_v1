import type { ReactNode } from "react";

import type { MapRuntimeMode } from "../../map-panel/types";
import type { MaonoMapPanelTab } from "./map-shell-events";
import "./maono-map-tokens.css";
import "./maono-map-shell.css";

type MaonoMapShellProps = {
  children: ReactNode;
  sidebar: ReactNode;
  topbar: ReactNode;
  panelHost: ReactNode;
  mode: MapRuntimeMode;
  panelAvailable: boolean;
  panelOpen: boolean;
  activePanelTab: MaonoMapPanelTab;
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
