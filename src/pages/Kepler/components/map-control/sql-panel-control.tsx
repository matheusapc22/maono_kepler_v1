// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// @ts-nocheck

import React, { useCallback, type ComponentType } from "react";

import {
  MapControlButton,
  MapControlTooltipFactory,
} from "@kepler.gl/components";

interface SQLControlIcons {
  sqlPanelIcon: ComponentType<any>;
}

export type SqlPanelControlProps = {
  // mapControls: MapControls;
  mapControls: any;
  onToggleMapControl: (control: string) => void;
  actionIcons: SQLControlIcons;
};

SqlPanelControlFactory.deps = [MapControlTooltipFactory];

export default function SqlPanelControlFactory(
  MapControlTooltip: ReturnType<typeof MapControlTooltipFactory>
): React.FC<SqlPanelControlProps> {
  const SqlPanelControl = ({ mapControls, onToggleMapControl }) => {
    const onClick = useCallback(
      (event) => {
        event.preventDefault();
        onToggleMapControl("sqlPanel");
      },
      [onToggleMapControl]
    );

    const showControl = mapControls?.sqlPanel?.show;
    if (!showControl) {
      return null;
    }

    const active = mapControls?.sqlPanel?.active;
    return (
      <MapControlTooltip
        id="show-sql-panel"
        message={active ? "tooltip.hideSQLPanel" : "tooltip.showSQLPanel"}
      >
        <MapControlButton
          className="map-control-button toggle-sql-panel"
          onClick={onClick}
          active={active}
        >
          SQL
        </MapControlButton>
      </MapControlTooltip>
    );
  };

  return SqlPanelControl;
}
