import { WebMercatorViewport } from "@deck.gl/core";
import type { Feature } from "@kepler.gl/types";

import type { MapViewportSummary } from "../../engine-adapter/types.ts";
import { collectionToArray, readValue } from "../../engine-adapter/selectors.ts";
import type { MapCanvasRect } from "./marker-projection.ts";

export type GeometryScreenPoint = {
  x: number;
  y: number;
};

export type GeometryScreenRing = GeometryScreenPoint[];
export type GeometryScreenPolygon = GeometryScreenRing[];

export type ProjectedGeometryFilter = {
  polygons: GeometryScreenPolygon[];
  path: string;
};

function finiteCoordinate(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function projectCoordinate(
  coordinate: unknown,
  mapViewport: WebMercatorViewport,
  viewport: MapViewportSummary,
  canvasRect: MapCanvasRect,
): GeometryScreenPoint | null {
  const pair = collectionToArray<unknown>(coordinate);
  const longitude = finiteCoordinate(pair[0]);
  const latitude = finiteCoordinate(pair[1]);
  if (longitude === null || latitude === null) return null;

  const projected = mapViewport.project([longitude, latitude]);
  const x = Number(projected[0]);
  const y = Number(projected[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return {
    x: (x / viewport.width) * canvasRect.width,
    y: (y / viewport.height) * canvasRect.height,
  };
}

function projectRing(
  ring: unknown,
  mapViewport: WebMercatorViewport,
  viewport: MapViewportSummary,
  canvasRect: MapCanvasRect,
): GeometryScreenRing {
  return collectionToArray<unknown>(ring)
    .map((coordinate) =>
      projectCoordinate(coordinate, mapViewport, viewport, canvasRect),
    )
    .filter((point): point is GeometryScreenPoint => Boolean(point));
}

function projectPolygon(
  polygon: unknown,
  mapViewport: WebMercatorViewport,
  viewport: MapViewportSummary,
  canvasRect: MapCanvasRect,
): GeometryScreenPolygon {
  return collectionToArray<unknown>(polygon)
    .map((ring) => projectRing(ring, mapViewport, viewport, canvasRect))
    .filter((ring) => ring.length >= 3);
}

export function projectGeometryFilter(
  feature: Feature | null | undefined,
  viewport: MapViewportSummary | null,
  canvasRect: MapCanvasRect | null,
): ProjectedGeometryFilter | null {
  if (
    !feature ||
    !viewport ||
    !canvasRect ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    canvasRect.width <= 0 ||
    canvasRect.height <= 0
  ) {
    return null;
  }

  const geometry = readValue(feature, "geometry");
  const type = String(readValue(geometry, "type") ?? "");
  const coordinates = readValue(geometry, "coordinates");
  if (type !== "Polygon" && type !== "MultiPolygon") return null;

  const mapViewport = new WebMercatorViewport(viewport);
  const polygons =
    type === "Polygon"
      ? [projectPolygon(coordinates, mapViewport, viewport, canvasRect)]
      : collectionToArray<unknown>(coordinates).map((polygon) =>
          projectPolygon(polygon, mapViewport, viewport, canvasRect),
        );
  const validPolygons = polygons.filter(
    (polygon) => polygon.length > 0 && polygon[0].length >= 3,
  );
  if (!validPolygons.length) return null;

  const path = validPolygons
    .flatMap((polygon) => polygon)
    .map((ring) => {
      const [first, ...rest] = ring;
      if (!first) return "";
      return [
        `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`,
        ...rest.map(
          (point) => `L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
        ),
        "Z",
      ].join(" ");
    })
    .filter(Boolean)
    .join(" ");

  return {
    polygons: validPolygons,
    path,
  };
}

function squaredDistanceToSegment(
  point: GeometryScreenPoint,
  start: GeometryScreenPoint,
  end: GeometryScreenPoint,
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return (point.x - start.x) ** 2 + (point.y - start.y) ** 2;
  }

  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - start.x) * dx + (point.y - start.y) * dy) /
        (dx * dx + dy * dy),
    ),
  );
  const x = start.x + t * dx;
  const y = start.y + t * dy;
  return (point.x - x) ** 2 + (point.y - y) ** 2;
}

function pointOnRingBoundary(
  point: GeometryScreenPoint,
  ring: GeometryScreenRing,
  tolerancePixels: number,
) {
  const toleranceSquared = tolerancePixels * tolerancePixels;
  for (let index = 0; index < ring.length; index += 1) {
    const start = ring[index];
    const end = ring[(index + 1) % ring.length];
    if (
      start &&
      end &&
      squaredDistanceToSegment(point, start, end) <= toleranceSquared
    ) {
      return true;
    }
  }
  return false;
}

function pointInRing(point: GeometryScreenPoint, ring: GeometryScreenRing) {
  let inside = false;

  for (
    let current = 0, previous = ring.length - 1;
    current < ring.length;
    previous = current, current += 1
  ) {
    const a = ring[current];
    const b = ring[previous];
    if (!a || !b) continue;

    const intersects =
      a.y > point.y !== b.y > point.y &&
      point.x <
        ((b.x - a.x) * (point.y - a.y)) /
          (b.y - a.y || Number.EPSILON) +
          a.x;

    if (intersects) inside = !inside;
  }

  return inside;
}

/**
 * Hit-test apenas da interface. Não é o motor espacial do filtro: a inclusão
 * dos dados continua sendo calculada pelo engine do Kepler. Aqui a Maõno só
 * decide qual área visual o usuário clicou para abrir o próprio gestor.
 */
export function hitTestProjectedGeometry(
  geometry: ProjectedGeometryFilter,
  point: GeometryScreenPoint,
  boundaryTolerancePixels = 5,
) {
  for (const polygon of geometry.polygons) {
    if (
      polygon.some((ring) =>
        pointOnRingBoundary(point, ring, boundaryTolerancePixels),
      )
    ) {
      return true;
    }

    let inside = false;
    for (const ring of polygon) {
      if (pointInRing(point, ring)) inside = !inside;
    }
    if (inside) return true;
  }

  return false;
}
