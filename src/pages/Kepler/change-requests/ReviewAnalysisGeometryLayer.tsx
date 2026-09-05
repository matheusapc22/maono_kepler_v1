import { useCallback, useEffect, useState } from "react";

import {
  markerOriginToScreen,
  type MapCanvasRect,
} from "../components/map-overlay/marker-projection";
import type { MapViewportSummary } from "../engine-adapter/types";
import type { ReviewOperationProjection } from "./review-api";

type ScreenPath = {
  id: string;
  selected: boolean;
  d: string;
};

type Coordinate = [number, number, ...number[]];

function mapSurfaceRect(): MapCanvasRect | null {
  const node = document.querySelector<HTMLElement>(".maono-kepler-viewport");
  const rect = node?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function ringsFromGeometry(geometry: unknown): Coordinate[][] {
  const source = record(geometry);
  const type = String(source?.type || "");
  const coordinates = source?.coordinates;
  if (!Array.isArray(coordinates)) return [];
  if (type === "Polygon") {
    return coordinates.filter(Array.isArray) as Coordinate[][];
  }
  if (type === "MultiPolygon") {
    return coordinates.flatMap((polygon) =>
      Array.isArray(polygon) ? polygon.filter(Array.isArray) : [],
    ) as Coordinate[][];
  }
  return [];
}

function ringsFromGeoJson(value: unknown): Coordinate[][] {
  const source = record(value);
  if (!source) return [];
  if (source.type === "FeatureCollection" && Array.isArray(source.features)) {
    return source.features.flatMap((feature) =>
      ringsFromGeometry(record(feature)?.geometry),
    );
  }
  if (source.type === "Feature") return ringsFromGeometry(source.geometry);
  return ringsFromGeometry(source);
}

function ringPath(
  ring: Coordinate[],
  rect: MapCanvasRect,
  viewport: MapViewportSummary,
) {
  const projected = ring.flatMap((coordinate) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return [];
    const longitude = Number(coordinate[0]);
    const latitude = Number(coordinate[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return [];
    const position = markerOriginToScreen(
      { longitude, latitude },
      rect,
      viewport,
    );
    return position ? [[position.left, position.top] as const] : [];
  });
  if (projected.length < 3) return "";
  return `${projected
    .map(([left, top], index) => `${index === 0 ? "M" : "L"}${left} ${top}`)
    .join(" ")} Z`;
}

export function ReviewAnalysisGeometryLayer({
  operations,
  selectedId,
  visible,
  viewport,
}: {
  operations: ReviewOperationProjection[];
  selectedId: string | null;
  visible: boolean;
  viewport: MapViewportSummary | null;
}) {
  const [paths, setPaths] = useState<ScreenPath[]>([]);

  const refresh = useCallback(() => {
    if (!visible || !viewport) {
      setPaths([]);
      return;
    }
    const rect = mapSurfaceRect();
    if (!rect) return;
    const next = operations.flatMap((operation) => {
      if (operation.overlay?.kind !== "geojson") return [];
      const d = ringsFromGeoJson(operation.overlay.geojson)
        .map((ring) => ringPath(ring, rect, viewport))
        .filter(Boolean)
        .join(" ");
      return d
        ? [{ id: operation.id, selected: operation.id === selectedId, d }]
        : [];
    });
    setPaths(next);
  }, [operations, selectedId, viewport, visible]);

  useEffect(() => {
    refresh();
    window.addEventListener("resize", refresh);
    window.addEventListener("maono:map-runtime", refresh);
    return () => {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("maono:map-runtime", refresh);
    };
  }, [refresh]);

  if (!visible || !paths.length) return null;
  return (
    <svg
      aria-hidden="true"
      width="100%"
      height="100%"
      viewBox={`0 0 ${window.innerWidth} ${window.innerHeight}`}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 44,
      }}
    >
      {paths.map((path) => (
        <path
          key={path.id}
          d={path.d}
          fill="rgba(214, 158, 46, 0.22)"
          stroke="rgba(241, 210, 138, 0.96)"
          strokeWidth={path.selected ? 4 : 2}
          fillRule="evenodd"
        />
      ))}
    </svg>
  );
}
