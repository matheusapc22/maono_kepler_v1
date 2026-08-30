export type MaonoMapShellPanel = "layers" | "basemap";

export function maonoMapShellPanelLabel(panel: MaonoMapShellPanel) {
  return panel === "basemap" ? "Mapa base" : "Camadas";
}

export function maonoMapShellPanelControlId(panel: MaonoMapShellPanel) {
  return panel === "basemap" ? "maono-basemap-panel" : "maono-map-engine-panel";
}
