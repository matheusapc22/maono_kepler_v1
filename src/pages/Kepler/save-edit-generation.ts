/** Lightweight projection of KeplerGlSchema v1 inputs, without serializing data on edits. */
function read(value: any, key: string) { return typeof value?.get === "function" ? value.get(key) : value?.[key]; }
function values(value: any, keys: readonly string[]) { return keys.map(key => read(value, key)); }
export function persistedMapInputs(state: any): unknown[] {
  const vis = read(state, "visState");
  const map = read(state, "mapState");
  const style = read(state, "mapStyle");
  const legend = read(read(read(state, "uiState"), "mapControls"), "mapLegend");
  return [
    ...values(vis, ["datasets", "mapInfo", "layers", "layerOrder", "filters", "effects", "effectOrder", "interactionConfig", "layerBlending", "overlayBlending", "splitMaps"]),
    ...values(read(vis, "animationConfig"), ["currentTime", "speed"]),
    ...values(read(vis, "editor"), ["features", "visible"]),
    ...values(map, ["bearing", "dragRotate", "latitude", "longitude", "pitch", "zoom", "isSplit", "isViewportSynced", "isZoomLocked", "splitMapViewports"]),
    ...values(style, ["styleType", "topLayerGroups", "visibleLayerGroups", "threeDBuildingColor", "backgroundColor", "mapStyles"]),
    read(legend, "active"), ...values(read(legend, "settings"), ["position", "contentHeight"]),
  ];
}
export function createSaveEditGeneration(initialMap: any) {
  let previous = persistedMapInputs(initialMap);
  let generation = 0;
  return {
    get generation() { return generation; },
    observe(map: any) {
      const current = persistedMapInputs(map);
      if (current.some((value, index) => value !== previous[index])) generation += 1;
      previous = current;
      return generation;
    },
    observeExtensionChange() { generation += 1; return generation; },
  };
}
