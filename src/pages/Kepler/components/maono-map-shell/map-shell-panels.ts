export type MaonoMapShellPanel = "layers" | "basemap" | "data";

export function maonoMapShellPanelLabel(panel: MaonoMapShellPanel) {
  if (panel === "data") return "Adicionar dados";
  return panel === "basemap" ? "Mapa base" : "Camadas";
}

export function maonoMapShellPanelControlId(panel: MaonoMapShellPanel) {
  if (panel === "data") return "map-add-data-sidebar";
  return panel === "basemap" ? "maono-basemap-panel" : "maono-map-engine-panel";
}
