import { MapLegendPanelFactory } from "@kepler.gl/components";
import { MaonoMapLegendPanelFactory } from "./maono-map-legend-panel.tsx";

export { MaonoMapLegendPanelFactory };

export function replaceMapLegendPanel() {
  return [MapLegendPanelFactory, MaonoMapLegendPanelFactory];
}
