import {
  addLayer,
  removeLayer as removeKeplerLayer,
  reorderLayer as reorderKeplerLayer,
  wrapTo,
} from "@kepler.gl/actions";
import { useCallback } from "react";
import { useDispatch, useStore } from "react-redux";

import type { ViewerLayerSnapshot } from "../change-requests/viewer-layer-lifecycle.ts";
import {
  KEPLER_MAP_ID,
  collectionToArray,
  findRawDataset,
  findRawLayer,
  readValue,
  selectKeplerVisState,
} from "./selectors.ts";

function keplerColumns(snapshot: ViewerLayerSnapshot) {
  if (snapshot.type === "geojson") {
    return snapshot.columns.geojson
      ? { geojson: snapshot.columns.geojson }
      : {};
  }
  return {
    lat: snapshot.columns.latitude,
    lng: snapshot.columns.longitude,
    altitude: snapshot.columns.altitude,
  };
}

function range(colors: string[], name: string | null) {
  return colors.length
    ? {
        name: `maono:${name || "custom"}`,
        type: "sequential",
        category: "Custom",
        colors: [...colors],
      }
    : undefined;
}

export function viewerLayerSnapshotToKeplerLayer(snapshot: ViewerLayerSnapshot) {
  const dataId = snapshot.dataIds.length === 1
    ? snapshot.dataIds[0]
    : [...snapshot.dataIds];
  const visConfig: Record<string, unknown> = {
    opacity: snapshot.style.opacity,
    filled: snapshot.style.fillEnabled,
    strokeColor: [...snapshot.style.strokeColor],
    strokeOpacity: snapshot.style.strokeOpacity,
    thickness: snapshot.style.strokeWidth,
  };
  if (snapshot.type === "point") visConfig.outline = snapshot.style.strokeEnabled;
  else visConfig.stroked = snapshot.style.strokeEnabled;
  if (snapshot.style.pointRadius != null) visConfig.radius = snapshot.style.pointRadius;
  if (snapshot.style.clusterRadius != null) visConfig.clusterRadius = snapshot.style.clusterRadius;
  if (snapshot.style.heatmapRadius != null) visConfig.heatmapRadius = snapshot.style.heatmapRadius;
  if (snapshot.style.radiusRange) visConfig.radiusRange = [...snapshot.style.radiusRange];
  const colorRange = range(snapshot.style.colorPalette, snapshot.style.colorPaletteId);
  const strokeColorRange = range(
    snapshot.style.strokeColorPalette,
    snapshot.style.strokeColorPaletteId,
  );
  if (colorRange) visConfig.colorRange = colorRange;
  if (strokeColorRange) visConfig.strokeColorRange = strokeColorRange;

  const color = snapshot.visualChannels.color;
  const strokeColor = snapshot.visualChannels.strokeColor;
  const size = snapshot.visualChannels.size;
  const height = snapshot.visualChannels.height;

  return {
    id: snapshot.id,
    type: snapshot.type,
    config: {
      dataId,
      label: snapshot.label,
      isVisible: snapshot.isVisible,
      color: [...snapshot.style.color],
      columns: keplerColumns(snapshot),
      visConfig,
      colorField: color.field,
      colorScale: color.scale,
      strokeColorField: strokeColor.field,
      strokeColorScale: strokeColor.scale,
      sizeField: size.field,
      sizeScale: size.scale,
      heightField: height.field,
      heightScale: height.scale,
    },
    visualChannels: {
      colorField: color.field,
      colorScale: color.scale,
      strokeColorField: strokeColor.field,
      strokeColorScale: strokeColor.scale,
      sizeField: size.field,
      sizeScale: size.scale,
      heightField: height.field,
      heightScale: height.scale,
    },
  };
}

function orderedLayerIds(rootState: unknown) {
  const visState = selectKeplerVisState(rootState);
  const layers = collectionToArray<Record<string, unknown>>(readValue(visState, "layers"));
  const ids = layers.map((layer) => String(readValue(layer, "id") || "")).filter(Boolean);
  const explicit = collectionToArray<unknown>(readValue(visState, "layerOrder"))
    .map(String)
    .filter(Boolean);
  return explicit.length === ids.length && explicit.every((id) => ids.includes(id))
    ? explicit
    : ids;
}

function moveToIndex(ids: string[], layerId: string, index: number) {
  const without = ids.filter((id) => id !== layerId);
  const target = Math.max(0, Math.min(Number(index), without.length));
  without.splice(target, 0, layerId);
  return without;
}

export function useViewerLayerLifecycleReplayCommand() {
  const dispatch = useDispatch();
  const store = useStore();

  const restore = useCallback(
    (snapshot: ViewerLayerSnapshot, insertIndex: number) => {
      const rootState = store.getState();
      if (findRawLayer(rootState, snapshot.id)) {
        return { ok: true as const, changed: false };
      }
      for (const dataId of snapshot.dataIds) {
        if (!findRawDataset(rootState, dataId)) {
          return {
            ok: false as const,
            changed: false,
            reason: `O dataset ${dataId} não existe para restaurar a camada ${snapshot.label}.`,
          };
        }
      }
      try {
        dispatch(
          wrapTo(
            KEPLER_MAP_ID,
            addLayer(viewerLayerSnapshotToKeplerLayer(snapshot) as any),
          ),
        );
        const nextOrder = moveToIndex(
          orderedLayerIds(store.getState()),
          snapshot.id,
          insertIndex,
        );
        dispatch(wrapTo(KEPLER_MAP_ID, reorderKeplerLayer(nextOrder)));
        return { ok: true as const, changed: true };
      } catch (error) {
        return {
          ok: false as const,
          changed: false,
          reason: error instanceof Error ? error.message : "Falha ao restaurar camada.",
        };
      }
    },
    [dispatch, store],
  );

  const remove = useCallback(
    (layerId: string) => {
      const rootState = store.getState();
      if (!findRawLayer(rootState, layerId)) {
        return { ok: true as const, changed: false };
      }
      try {
        dispatch(wrapTo(KEPLER_MAP_ID, removeKeplerLayer(layerId)));
        return { ok: true as const, changed: true };
      } catch (error) {
        return {
          ok: false as const,
          changed: false,
          reason: error instanceof Error ? error.message : "Falha ao remover camada.",
        };
      }
    },
    [dispatch, store],
  );

  return { restore, remove };
}
