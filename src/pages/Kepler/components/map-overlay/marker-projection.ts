import { WebMercatorViewport } from "@deck.gl/core";

import type { MapViewportSummary } from "../../engine-adapter/types";

export type MarkerOrigin = {
  latitude: number;
  longitude: number;
};

export type MapCanvasRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type MarkerScreenPosition = {
  left: number;
  top: number;
};

export function normalizeLongitude(value: number) {
  let longitude = value;

  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;

  return longitude;
}

export function isValidMarkerOrigin(
  value: MarkerOrigin | null | undefined,
): value is MarkerOrigin {
  return Boolean(
    value &&
      Number.isFinite(value.latitude) &&
      Number.isFinite(value.longitude) &&
      value.latitude >= -90 &&
      value.latitude <= 90 &&
      value.longitude >= -180 &&
      value.longitude <= 180,
  );
}

function usableViewport(
  viewport: MapViewportSummary | null,
  canvasRect: MapCanvasRect | null,
) {
  return Boolean(
    viewport &&
      canvasRect &&
      viewport.width > 0 &&
      viewport.height > 0 &&
      canvasRect.width > 0 &&
      canvasRect.height > 0,
  );
}

export function screenToMarkerOrigin(
  clientX: number,
  clientY: number,
  canvasRect: MapCanvasRect | null,
  viewport: MapViewportSummary | null,
): MarkerOrigin | null {
  if (!usableViewport(viewport, canvasRect) || !viewport || !canvasRect) {
    return null;
  }

  const x =
    ((clientX - canvasRect.left) / canvasRect.width) * viewport.width;
  const y =
    ((clientY - canvasRect.top) / canvasRect.height) * viewport.height;
  const mapViewport = new WebMercatorViewport(viewport);
  const [rawLongitude, latitude] = mapViewport.unproject([x, y]);
  const origin = {
    latitude,
    longitude: normalizeLongitude(rawLongitude),
  };

  return isValidMarkerOrigin(origin) ? origin : null;
}

export function markerOriginToScreen(
  origin: MarkerOrigin | null,
  canvasRect: MapCanvasRect | null,
  viewport: MapViewportSummary | null,
): MarkerScreenPosition | null {
  if (
    !isValidMarkerOrigin(origin) ||
    !usableViewport(viewport, canvasRect) ||
    !viewport ||
    !canvasRect
  ) {
    return null;
  }

  const mapViewport = new WebMercatorViewport(viewport);
  const [x, y] = mapViewport.project([origin.longitude, origin.latitude]);

  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return {
    left: canvasRect.left + (x / viewport.width) * canvasRect.width,
    top: canvasRect.top + (y / viewport.height) * canvasRect.height,
  };
}

export function nudgeMarkerOrigin(
  origin: MarkerOrigin | null,
  horizontalPixels: number,
  verticalPixels: number,
  viewport: MapViewportSummary | null,
): MarkerOrigin | null {
  if (!isValidMarkerOrigin(origin) || !viewport) return null;

  const mapViewport = new WebMercatorViewport(viewport);
  const [x, y] = mapViewport.project([origin.longitude, origin.latitude]);
  const [rawLongitude, latitude] = mapViewport.unproject([
    x + horizontalPixels,
    y + verticalPixels,
  ]);
  const next = {
    latitude,
    longitude: normalizeLongitude(rawLongitude),
  };

  return isValidMarkerOrigin(next) ? next : null;
}
