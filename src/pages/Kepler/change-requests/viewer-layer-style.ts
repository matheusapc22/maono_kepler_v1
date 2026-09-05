import type {
  KeplerEngineCommands,
  MapLayerStyle,
} from "../engine-adapter/types";
import type {
  ViewerLayerStyleChanges,
} from "./viewer-working-copy";

export type ViewerLayerStyleSnapshot = Pick<
  MapLayerStyle,
  | "color"
  | "opacity"
  | "fillEnabled"
  | "strokeEnabled"
  | "strokeColor"
  | "strokeOpacity"
  | "strokeWidth"
  | "pointRadius"
  | "clusterRadius"
  | "heatmapRadius"
>;

function sameArray(left: readonly unknown[] | null, right: readonly unknown[] | null) {
  if (left === right) return true;
  if (!left || !right || left.length !== right.length) return false;
  return left.every((value, index) => Object.is(value, right[index]));
}

export function snapshotViewerLayerStyle(style: MapLayerStyle): ViewerLayerStyleSnapshot {
  return {
    color: [...style.color] as [number, number, number],
    opacity: style.opacity,
    fillEnabled: style.fillEnabled,
    strokeEnabled: style.strokeEnabled,
    strokeColor: [...style.strokeColor] as [number, number, number],
    strokeOpacity: style.strokeOpacity,
    strokeWidth: style.strokeWidth,
    pointRadius: style.pointRadius,
    clusterRadius: style.clusterRadius,
    heatmapRadius: style.heatmapRadius,
  };
}

export function diffViewerLayerStyle(
  base: ViewerLayerStyleSnapshot,
  current: MapLayerStyle,
): ViewerLayerStyleChanges {
  const changes: ViewerLayerStyleChanges = {};

  if (!sameArray(base.color, current.color)) {
    changes.fixedColor = [...current.color] as [number, number, number];
  }
  if (!Object.is(base.opacity, current.opacity)) changes.opacity = current.opacity;
  if (!Object.is(base.fillEnabled, current.fillEnabled)) {
    changes.fillEnabled = current.fillEnabled;
  }
  if (!Object.is(base.strokeEnabled, current.strokeEnabled)) {
    changes.strokeEnabled = current.strokeEnabled;
  }
  if (!sameArray(base.strokeColor, current.strokeColor)) {
    changes.strokeColor = [...current.strokeColor] as [number, number, number];
  }
  if (!Object.is(base.strokeOpacity, current.strokeOpacity)) {
    changes.strokeOpacity = current.strokeOpacity;
  }
  if (!Object.is(base.strokeWidth, current.strokeWidth)) {
    changes.strokeWidth = current.strokeWidth;
  }
  if (
    current.pointRadius !== null &&
    !Object.is(base.pointRadius, current.pointRadius)
  ) {
    changes.pointRadius = current.pointRadius;
  }
  if (
    current.clusterRadius !== null &&
    !Object.is(base.clusterRadius, current.clusterRadius)
  ) {
    changes.clusterRadius = current.clusterRadius;
  }
  if (
    current.heatmapRadius !== null &&
    !Object.is(base.heatmapRadius, current.heatmapRadius)
  ) {
    changes.heatmapRadius = current.heatmapRadius;
  }

  return changes;
}

export function hasViewerLayerStyleChanges(changes: ViewerLayerStyleChanges) {
  return Object.keys(changes).length > 0;
}

export function viewerLayerStyleChangesEqual(
  left: ViewerLayerStyleChanges | null | undefined,
  right: ViewerLayerStyleChanges | null | undefined,
) {
  return JSON.stringify(left || {}) === JSON.stringify(right || {});
}

export function applyViewerLayerStyleChanges(
  commands: KeplerEngineCommands,
  layerId: string,
  changes: ViewerLayerStyleChanges,
) {
  const results = [];
  if (changes.fixedColor) {
    results.push(commands.setFixedColor(layerId, changes.fixedColor));
  }
  if (changes.opacity !== undefined) {
    results.push(commands.setLayerOpacity(layerId, changes.opacity));
  }
  if (changes.fillEnabled !== undefined) {
    results.push(commands.setFillEnabled(layerId, changes.fillEnabled));
  }
  if (changes.strokeEnabled !== undefined) {
    results.push(commands.setStrokeEnabled(layerId, changes.strokeEnabled));
  }
  if (changes.strokeColor) {
    results.push(commands.setStrokeColor(layerId, changes.strokeColor));
  }
  if (changes.strokeOpacity !== undefined) {
    results.push(commands.setStrokeOpacity(layerId, changes.strokeOpacity));
  }
  if (changes.strokeWidth !== undefined) {
    results.push(commands.setStrokeWidth(layerId, changes.strokeWidth));
  }
  if (changes.pointRadius !== undefined) {
    results.push(commands.setPointRadius(layerId, changes.pointRadius));
  }
  if (changes.clusterRadius !== undefined) {
    results.push(commands.setClusterOptions(layerId, { radius: changes.clusterRadius }));
  }
  if (changes.heatmapRadius !== undefined) {
    results.push(commands.setHeatmapOptions(layerId, { radius: changes.heatmapRadius }));
  }

  const failed = results.find((result) => !result.ok);
  return {
    ok: !failed,
    changed: results.some((result) => result.ok && result.changed),
    error: failed && !failed.ok ? failed.reason : null,
  };
}
