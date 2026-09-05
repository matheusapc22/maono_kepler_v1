export function withWorkspaceEditingParity(context) {
  if (!context?.capabilities || !context?.mode) return context;

  const capabilities = { ...context.capabilities };

  if (context.mode === "viewer") {
    Object.assign(capabilities, {
      configureTooltips: true,
      editLayers: true,
      editStyle: true,
      editLayerStyle: true,
      // O Viewer pode criar/organizar camadas e propor uma nova camada de pontos.
      // Importação genérica de datasets permanece separada e bloqueada.
      createLayer: true,
      addData: true,
      importData: false,
      createPoint: true,
      removeLayer: true,
      duplicateLayer: true,
      reorderLayers: true,
      manageFilters: true,
      editFilters: true,
      placeAnalysisMarker: true,
      persistIsochrone: capabilities.previewIsochrone === true,
      persistBuffer: capabilities.previewBuffer === true,
      removeIsochrone: capabilities.previewIsochrone === true,
      saveMap: false,
      editMetadata: false,
      editProjectMetadata: false,
      updateThumbnail: false,
      requestProjectChange: true,
      reviewProjectChange: false,
      applyProjectChange: false,
    });
  } else if (context.mode === "editor" || context.mode === "create") {
    capabilities.placeAnalysisMarker = true;
    capabilities.createPoint = true;
    capabilities.addData = true;
    capabilities.importData = true;
  }

  return { ...context, capabilities };
}
