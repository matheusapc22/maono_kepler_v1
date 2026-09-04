export function withWorkspaceEditingParity(context) {
  if (!context?.capabilities || !context?.mode) return context;

  const capabilities = { ...context.capabilities };

  if (context.mode === "viewer") {
    Object.assign(capabilities, {
      configureTooltips: true,
      editLayers: true,
      editStyle: true,
      editLayerStyle: true,
      // Criar/organizar camadas existentes continua sendo edição local;
      // importar ou nascer um dataset novo é a capacidade ortogonal addData.
      createLayer: true,
      addData: false,
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
    capabilities.addData = true;
    capabilities.createPoint = true;
  }

  return { ...context, capabilities };
}
