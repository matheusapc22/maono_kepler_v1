export * from "./viewer-persistent-mutations-core.ts";

import { layerStyleCompatibilityForType } from "../engine-adapter/layer-style-management.ts";
import type { KeplerEngineCommands } from "../engine-adapter/types.ts";
import type { ViewerLayerDefinitionSnapshot } from "./viewer-persistent-mutations-core.ts";

export function applyViewerLayerDefinition(
  commands: KeplerEngineCommands,
  layerId: string,
  snapshot: ViewerLayerDefinitionSnapshot,
) {
  const results = [];
  results.push(commands.renameLayer(layerId, snapshot.label));
  results.push(commands.setLayerType(layerId, snapshot.type));
  if (snapshot.dataIds.length === 1) {
    results.push(commands.associateLayerDataset(layerId, snapshot.dataIds[0]));
  }
  results.push(commands.setLayerColumns(layerId, snapshot.columns));

  const compatibility = layerStyleCompatibilityForType(snapshot.type);
  if (compatibility.colorField) {
    results.push(commands.setColorField(layerId, snapshot.colorField));
    if (snapshot.colorField && snapshot.colorScale) {
      results.push(commands.setColorScale(layerId, snapshot.colorScale));
    }
  }
  if (compatibility.palette && snapshot.colorPalette.length >= 2) {
    results.push(commands.setColorPalette(layerId, snapshot.colorPalette));
  }
  if (compatibility.strokeField) {
    results.push(commands.setStrokeColorField(layerId, snapshot.strokeColorField));
    if (snapshot.strokeColorField && snapshot.strokeColorScale) {
      results.push(commands.setStrokeColorScale(layerId, snapshot.strokeColorScale));
    }
    if (snapshot.strokeColorPalette.length >= 2) {
      results.push(commands.setStrokeColorPalette(layerId, snapshot.strokeColorPalette));
    }
  }
  if (compatibility.radiusField) {
    results.push(commands.setRadiusField(layerId, snapshot.radiusField));
  }
  if (compatibility.radiusRange && snapshot.radiusRange) {
    results.push(commands.setLayerRadiusRange(layerId, snapshot.radiusRange));
  }

  return {
    ok: results.every((result) => result.ok),
    changed: results.some((result) => result.ok && result.changed),
    error: results.find((result) => !result.ok)?.reason || null,
  };
}
