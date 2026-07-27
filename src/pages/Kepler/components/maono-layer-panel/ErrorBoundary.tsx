import React from "react";
import { emitMapPanelTelemetry } from "../../map-panel/map-panel-telemetry";

type State = {
  error: Error | null;
};

export default class MaonoLayerPanelErrorBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    emitMapPanelTelemetry("map_panel_fallback_used", {
      code: error.name || "LAYER_PANEL_ERROR",
      component: "MaonoLayerPanel",
    });
  }

  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}
