import { WebMercatorViewport } from "@deck.gl/core";

import {
  collectionToArray,
  readValue,
  selectKeplerVisState,
} from "./selectors.ts";
import type {
  MapBounds,
  MapFilterSummary,
  MapViewportSummary,
} from "./types.ts";

export const MAP_FLIGHT_DEFAULTS = Object.freeze({
  durationMs: 1_200,
  paddingPx: 100,
  zoomContext: 0.35,
  innerMarginRatio: 0.15,
  zoomDifferenceThreshold: 0.8,
  maximumCoordinates: 50_000,
});

const WEB_MERCATOR_MAX_LATITUDE = 85.051129;
const MINIMUM_POINT_SPAN = 0.02;

export type MapFocusMode = "visible" | "filtered";

export type NavigationTargetOptions = Partial<
  Pick<
    typeof MAP_FLIGHT_DEFAULTS,
    "paddingPx" | "zoomContext"
  >
>;

type MutableBounds = {
  minimumLatitude: number;
  maximumLatitude: number;
  longitudes: number[];
  points: number;
  sampled: boolean;
};

type DatasetEntry = [string, any];

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampLatitude(latitude: number) {
  return Math.max(
    -WEB_MERCATOR_MAX_LATITUDE,
    Math.min(WEB_MERCATOR_MAX_LATITUDE, latitude),
  );
}

export function normalizeLongitude(longitude: number) {
  return ((longitude + 540) % 360) - 180;
}

export function shortestLongitudeDelta(from: number, to: number) {
  return ((to - from + 540) % 360) - 180;
}

export function easeInOutCubic(progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  return t < 0.5
    ? 4 * t * t * t
    : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function interpolateViewport(
  start: MapViewportSummary,
  target: MapViewportSummary,
  progress: number,
): MapViewportSummary {
  const eased = easeInOutCubic(progress);
  const longitudeDelta = shortestLongitudeDelta(
    start.longitude,
    target.longitude,
  );

  return {
    longitude: normalizeLongitude(
      start.longitude + longitudeDelta * eased,
    ),
    latitude:
      start.latitude + (target.latitude - start.latitude) * eased,
    zoom: start.zoom + (target.zoom - start.zoom) * eased,
    bearing:
      start.bearing + (target.bearing - start.bearing) * eased,
    pitch: start.pitch + (target.pitch - start.pitch) * eased,
    width: start.width,
    height: start.height,
  };
}

function arrayValueIsEffective(value: unknown) {
  return Array.isArray(value) && value.length > 0;
}

function rangeIsEffective(filter: MapFilterSummary) {
  const value = Array.isArray(filter.value)
    ? filter.value.map(Number)
    : [];
  if (
    value.length !== 2 ||
    !value.every(Number.isFinite)
  ) {
    return false;
  }

  const domain = filter.domain.map(Number);
  if (
    domain.length >= 2 &&
    domain.slice(0, 2).every(Number.isFinite)
  ) {
    return value[0] !== domain[0] || value[1] !== domain[1];
  }

  return true;
}

export function hasEffectiveFilter(
  filters: readonly MapFilterSummary[],
) {
  return filters.some((filter) => {
    if (!filter.enabled || !filter.compatible) return false;

    if (filter.type === "range" || filter.type === "timeRange") {
      return rangeIsEffective(filter);
    }

    if (filter.type === "multiSelect") {
      if (!arrayValueIsEffective(filter.value)) return false;
      return !filter.domainSize ||
        (filter.value as unknown[]).length < filter.domainSize;
    }

    if (filter.type === "select") {
      return typeof filter.value === "boolean";
    }

    return false;
  });
}

function toPlainRecord(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object") return {};
  if (typeof (value as any).toJS === "function") {
    const plain = (value as any).toJS();
    return plain && typeof plain === "object" ? plain : {};
  }
  return value as Record<string, any>;
}

function datasetEntries(value: unknown): DatasetEntry[] {
  if (!value || typeof value !== "object") return [];
  if (typeof (value as any).entrySeq === "function") {
    return (value as any).entrySeq().toArray();
  }
  if (value instanceof Map) return Array.from(value.entries());
  return Object.entries(value as Record<string, any>);
}

function normalizedColumn(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  const name = readValue(value, "value") ?? readValue(value, "name");
  return typeof name === "string" ? name.trim() || null : null;
}

function normalizedDataIds(value: unknown) {
  const array = collectionToArray<unknown>(value);
  const values = array.length
    ? array
    : value == null
      ? []
      : [value];
  return Array.from(
    new Set(
      values
        .map((entry) => String(entry ?? "").trim())
        .filter(Boolean),
    ),
  );
}

function rawFields(dataset: any) {
  return collectionToArray<any>(
    readValue(dataset, "fields") ??
      readValue(readValue(dataset, "data"), "fields"),
  );
}

function fieldIndex(dataset: any, fieldName: string | null) {
  if (!fieldName) return -1;
  return rawFields(dataset).findIndex(
    (field) => String(readValue(field, "name") ?? "") === fieldName,
  );
}

function datasetCell(dataset: any, rowIndex: number, columnIndex: number) {
  const container = readValue(dataset, "dataContainer");
  if (container && typeof container.valueAt === "function") {
    return container.valueAt(rowIndex, columnIndex);
  }

  const rows = readValue(dataset, "allData");
  return rows?.[rowIndex]?.[columnIndex];
}

function inferredIndexes(dataset: any) {
  const allIndexes = collectionToArray<number>(
    readValue(dataset, "allIndexes"),
  );
  if (allIndexes.length) return allIndexes;

  const rows = readValue(dataset, "allData");
  if (Array.isArray(rows)) {
    return Array.from({ length: rows.length }, (_, index) => index);
  }

  const container = readValue(dataset, "dataContainer");
  const rowCount = finiteNumber(
    readValue(container, "numRows") ?? readValue(container, "length"),
  );
  return rowCount && rowCount > 0
    ? Array.from({ length: Math.floor(rowCount) }, (_, index) => index)
    : [];
}

function distributedSample<T>(values: readonly T[], maximum: number) {
  if (values.length <= maximum) {
    return { values: [...values], sampled: false };
  }

  const sampled: T[] = [];
  const last = values.length - 1;
  for (let index = 0; index < maximum; index += 1) {
    sampled.push(values[Math.round((index * last) / (maximum - 1))]);
  }
  return { values: sampled, sampled: true };
}

function datasetIndexes(
  dataset: any,
  filteredOnly: boolean,
  maximum: number,
) {
  const filteredIndex = readValue(dataset, "filteredIndex");
  const source =
    filteredOnly && filteredIndex != null
      ? collectionToArray<number>(filteredIndex)
      : inferredIndexes(dataset);

  return distributedSample(source, maximum);
}

function addCoordinate(
  accumulator: MutableBounds,
  longitudeValue: unknown,
  latitudeValue: unknown,
  maximumCoordinates: number,
) {
  if (accumulator.points >= maximumCoordinates) {
    accumulator.sampled = true;
    return;
  }

  const longitude = finiteNumber(longitudeValue);
  const latitude = finiteNumber(latitudeValue);
  if (longitude === null || latitude === null) return;
  if (latitude < -90 || latitude > 90) return;

  const safeLatitude = clampLatitude(latitude);
  accumulator.minimumLatitude = Math.min(
    accumulator.minimumLatitude,
    safeLatitude,
  );
  accumulator.maximumLatitude = Math.max(
    accumulator.maximumLatitude,
    safeLatitude,
  );
  accumulator.longitudes.push(normalizeLongitude(longitude));
  accumulator.points += 1;
}

function visitCoordinates(
  accumulator: MutableBounds,
  coordinates: unknown,
  maximumCoordinates: number,
): void {
  if (accumulator.points >= maximumCoordinates) {
    accumulator.sampled = true;
    return;
  }
  if (!Array.isArray(coordinates)) return;

  if (
    coordinates.length >= 2 &&
    finiteNumber(coordinates[0]) !== null &&
    finiteNumber(coordinates[1]) !== null
  ) {
    addCoordinate(
      accumulator,
      coordinates[0],
      coordinates[1],
      maximumCoordinates,
    );
    return;
  }

  for (const child of coordinates) {
    visitCoordinates(accumulator, child, maximumCoordinates);
    if (accumulator.points >= maximumCoordinates) break;
  }
}

function visitGeometry(
  accumulator: MutableBounds,
  value: unknown,
  maximumCoordinates: number,
) {
  let geometry = value;
  if (typeof geometry === "string") {
    try {
      geometry = JSON.parse(geometry);
    } catch {
      return;
    }
  }

  if (!geometry || typeof geometry !== "object") return;

  const type = String(readValue(geometry, "type") ?? "");
  if (type === "FeatureCollection") {
    for (const feature of collectionToArray(
      readValue(geometry, "features"),
    )) {
      visitGeometry(accumulator, feature, maximumCoordinates);
      if (accumulator.points >= maximumCoordinates) break;
    }
    return;
  }
  if (type === "Feature") {
    visitGeometry(
      accumulator,
      readValue(geometry, "geometry"),
      maximumCoordinates,
    );
    return;
  }
  if (type === "GeometryCollection") {
    for (const child of collectionToArray(
      readValue(geometry, "geometries"),
    )) {
      visitGeometry(accumulator, child, maximumCoordinates);
      if (accumulator.points >= maximumCoordinates) break;
    }
    return;
  }

  visitCoordinates(
    accumulator,
    readValue(geometry, "coordinates") ??
      readValue(readValue(geometry, "geometry"), "coordinates") ??
      geometry,
    maximumCoordinates,
  );
}

function minimalLongitudeBounds(longitudes: readonly number[]) {
  if (!longitudes.length) return null;

  const circular = longitudes
    .map((longitude) => ((longitude % 360) + 360) % 360)
    .sort((left, right) => left - right);

  if (circular.length === 1) {
    const longitude = normalizeLongitude(circular[0]);
    return {
      minimum: longitude - MINIMUM_POINT_SPAN,
      maximum: longitude + MINIMUM_POINT_SPAN,
    };
  }

  let largestGap = -1;
  let largestGapIndex = 0;
  for (let index = 0; index < circular.length; index += 1) {
    const current = circular[index];
    const next =
      index === circular.length - 1
        ? circular[0] + 360
        : circular[index + 1];
    const gap = next - current;
    if (gap > largestGap) {
      largestGap = gap;
      largestGapIndex = index;
    }
  }

  const startIndex = (largestGapIndex + 1) % circular.length;
  const start = circular[startIndex];
  const rawEnd = circular[largestGapIndex];
  const end = rawEnd < start ? rawEnd + 360 : rawEnd;
  const minimum = normalizeLongitude(start);
  const width = Math.max(0, end - start);

  return {
    minimum,
    maximum: minimum + Math.max(width, MINIMUM_POINT_SPAN * 2),
  };
}

export function calculateNavigationBounds(
  rootState: unknown,
  options: {
    filteredOnly?: boolean;
    maximumCoordinates?: number;
  } = {},
): MapBounds | null {
  const filteredOnly = options.filteredOnly === true;
  const maximumCoordinates = Math.max(
    500,
    Math.floor(
      options.maximumCoordinates ??
        MAP_FLIGHT_DEFAULTS.maximumCoordinates,
    ),
  );
  const visState = selectKeplerVisState(rootState);
  const layers = collectionToArray<any>(readValue(visState, "layers"))
    .filter((layer) => {
      const config = toPlainRecord(readValue(layer, "config"));
      const type = String(readValue(layer, "type") ?? "").toLowerCase();
      return (
        config.isVisible !== false &&
        ["point", "cluster", "heatmap", "geojson"].includes(type)
      );
    });
  if (!layers.length) return null;

  const datasets = new Map(
    datasetEntries(readValue(visState, "datasets")).map(([key, dataset]) => [
      String(readValue(dataset, "id") ?? key),
      dataset,
    ]),
  );
  const accumulator: MutableBounds = {
    minimumLatitude: Number.POSITIVE_INFINITY,
    maximumLatitude: Number.NEGATIVE_INFINITY,
    longitudes: [],
    points: 0,
    sampled: false,
  };
  const layerBudget = Math.max(
    500,
    Math.floor(maximumCoordinates / layers.length),
  );

  for (const layer of layers) {
    const config = toPlainRecord(readValue(layer, "config"));
    const columns = toPlainRecord(config.columns);
    const type = String(readValue(layer, "type") ?? "").toLowerCase();
    const dataIds = normalizedDataIds(
      config.dataId ?? readValue(layer, "dataId"),
    );

    for (const dataId of dataIds) {
      const dataset = datasets.get(dataId);
      if (!dataset) continue;

      const indexesResult = datasetIndexes(
        dataset,
        filteredOnly,
        layerBudget,
      );
      accumulator.sampled ||= indexesResult.sampled;

      if (type === "geojson") {
        const geojsonField = normalizedColumn(
          columns.geojson ?? columns.geometry,
        );
        const geojsonIndex = fieldIndex(dataset, geojsonField);
        if (geojsonIndex < 0) continue;

        for (const rowIndex of indexesResult.values) {
          visitGeometry(
            accumulator,
            datasetCell(dataset, rowIndex, geojsonIndex),
            maximumCoordinates,
          );
          if (accumulator.points >= maximumCoordinates) break;
        }
      } else {
        const latitudeField = normalizedColumn(
          columns.lat ?? columns.latitude,
        );
        const longitudeField = normalizedColumn(
          columns.lng ?? columns.longitude,
        );
        const latitudeIndex = fieldIndex(dataset, latitudeField);
        const longitudeIndex = fieldIndex(dataset, longitudeField);
        if (latitudeIndex < 0 || longitudeIndex < 0) continue;

        for (const rowIndex of indexesResult.values) {
          addCoordinate(
            accumulator,
            datasetCell(dataset, rowIndex, longitudeIndex),
            datasetCell(dataset, rowIndex, latitudeIndex),
            maximumCoordinates,
          );
          if (accumulator.points >= maximumCoordinates) break;
        }
      }

      if (accumulator.points >= maximumCoordinates) break;
    }
    if (accumulator.points >= maximumCoordinates) break;
  }

  if (!accumulator.points) return null;
  const longitudeBounds = minimalLongitudeBounds(accumulator.longitudes);
  if (!longitudeBounds) return null;

  let minimumLatitude = accumulator.minimumLatitude;
  let maximumLatitude = accumulator.maximumLatitude;
  if (minimumLatitude === maximumLatitude) {
    minimumLatitude = clampLatitude(
      minimumLatitude - MINIMUM_POINT_SPAN,
    );
    maximumLatitude = clampLatitude(
      maximumLatitude + MINIMUM_POINT_SPAN,
    );
  }

  return {
    minLongitude: longitudeBounds.minimum,
    minLatitude: minimumLatitude,
    maxLongitude: longitudeBounds.maximum,
    maxLatitude: maximumLatitude,
    sampled: accumulator.sampled,
  };
}

export function fitNavigationTarget(
  viewportState: MapViewportSummary | null | undefined,
  bounds: MapBounds | null,
  options: NavigationTargetOptions = {},
): MapViewportSummary | null {
  if (
    !viewportState ||
    !bounds ||
    viewportState.width <= 0 ||
    viewportState.height <= 0
  ) {
    return null;
  }

  const paddingPx = options.paddingPx ?? MAP_FLIGHT_DEFAULTS.paddingPx;
  const zoomContext =
    options.zoomContext ?? MAP_FLIGHT_DEFAULTS.zoomContext;
  const viewport = new WebMercatorViewport({
    width: viewportState.width,
    height: viewportState.height,
  });
  const fitted = viewport.fitBounds(
    [
      [bounds.minLongitude, bounds.minLatitude],
      [bounds.maxLongitude, bounds.maxLatitude],
    ],
    { padding: paddingPx },
  );
  const [longitude, latitude] = fitted.unproject([
    viewportState.width / 2,
    viewportState.height / 2,
  ]);

  return {
    longitude: normalizeLongitude(longitude),
    latitude: clampLatitude(latitude),
    zoom: Math.max(0, Number(fitted.zoom) - zoomContext),
    bearing: viewportState.bearing,
    pitch: viewportState.pitch,
    width: viewportState.width,
    height: viewportState.height,
  };
}

export function viewportNeedsFocus(
  viewportState: MapViewportSummary | null | undefined,
  target: MapViewportSummary | null,
  options: Partial<
    Pick<
      typeof MAP_FLIGHT_DEFAULTS,
      "innerMarginRatio" | "zoomDifferenceThreshold"
    >
  > = {},
) {
  if (!viewportState || !target) return false;
  if (viewportState.width <= 0 || viewportState.height <= 0) return false;

  const marginRatio =
    options.innerMarginRatio ?? MAP_FLIGHT_DEFAULTS.innerMarginRatio;
  const zoomThreshold =
    options.zoomDifferenceThreshold ??
    MAP_FLIGHT_DEFAULTS.zoomDifferenceThreshold;
  const viewport = new WebMercatorViewport(viewportState);
  const nearestLongitude =
    viewportState.longitude +
    shortestLongitudeDelta(
      viewportState.longitude,
      target.longitude,
    );
  const [x, y] = viewport.project([
    nearestLongitude,
    target.latitude,
  ]);
  const marginX = viewportState.width * marginRatio;
  const marginY = viewportState.height * marginRatio;
  const outside =
    x < marginX ||
    x > viewportState.width - marginX ||
    y < marginY ||
    y > viewportState.height - marginY;
  const zoomDifference = Math.abs(
    viewportState.zoom - target.zoom,
  );

  return outside || zoomDifference > zoomThreshold;
}
