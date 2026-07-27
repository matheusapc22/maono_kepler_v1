import {
  DEFAULT_MINIMUM_POINT_COUNT,
  MAX_CLIENT_POINT_COUNT,
  getAdaptivePointClusterDefaults,
  type PointClusterDeliveryClass,
} from "./point-cluster-policy.ts";

export type PointClusterEligibilityReason =
  | "eligible"
  | "unsupported_layer"
  | "mixed_geometry"
  | "missing_coordinates"
  | "invalid_coordinates"
  | "technical_read_only"
  | "temporal_animation"
  | "below_minimum"
  | "tile_required";

export type PointClusterEligibility = {
  eligible: boolean;
  reason: PointClusterEligibilityReason;
  pointCount: number;
  delivery: PointClusterDeliveryClass;
  latitudeColumn: string | null;
  longitudeColumn: string | null;
  geoJsonColumn: string | null;
  sourceKind: "point" | "geojson-point" | "unsupported";
};

type CoordinateColumns = {
  latitudeColumn: string | null;
  longitudeColumn: string | null;
};

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizedFieldName(value: unknown) {
  return typeof value === "string"
    ? value.trim().toLocaleLowerCase()
    : "";
}

function fieldName(field: unknown) {
  if (typeof field === "string") {
    return field;
  }
  return isRecord(field) && typeof field.name === "string"
    ? field.name
    : isRecord(field) && typeof field.value === "string"
      ? field.value
      : null;
}

function resolveCoordinateColumns(
  layer: any,
  dataset: any,
): CoordinateColumns {
  const configured = layer?.config?.columns ?? layer?.columns ?? {};
  const configuredLatitude = fieldName(
    configured.lat ?? configured.latitude,
  );
  const configuredLongitude = fieldName(
    configured.lng ?? configured.lon ?? configured.longitude,
  );

  if (configuredLatitude && configuredLongitude) {
    return {
      latitudeColumn: configuredLatitude,
      longitudeColumn: configuredLongitude,
    };
  }

  const fields =
    dataset?.fields ??
    dataset?.data?.fields ??
    dataset?.dataContainer?.fields ??
    [];
  const names = Array.isArray(fields)
    ? fields.map(fieldName).filter((name): name is string => Boolean(name))
    : [];

  const latitudeColumn =
    names.find((name) =>
      ["latitude", "lat", "y"].includes(normalizedFieldName(name)),
    ) ?? null;
  const longitudeColumn =
    names.find((name) =>
      ["longitude", "lng", "lon", "long", "x"].includes(
        normalizedFieldName(name),
      ),
    ) ?? null;

  return {
    latitudeColumn,
    longitudeColumn,
  };
}

function rowsFromDataset(dataset: any) {
  const candidates = [
    dataset?.data?.allData,
    dataset?.allData,
    dataset?.data?.rows,
    dataset?.rows,
    dataset?.data,
  ];

  return (
    candidates.find((candidate) => Array.isArray(candidate)) ?? []
  );
}

function rowValue(
  row: any,
  columnName: string,
  dataset: any,
) {
  if (isRecord(row)) {
    return row[columnName];
  }

  if (Array.isArray(row)) {
    const fields =
      dataset?.fields ?? dataset?.data?.fields ?? [];
    const fieldIndex = Array.isArray(fields)
      ? fields.findIndex(
          (field) => fieldName(field) === columnName,
        )
      : -1;
    return fieldIndex >= 0 ? row[fieldIndex] : undefined;
  }

  return undefined;
}

function inspectCoordinateValidity(
  dataset: any,
  latitudeColumn: string,
  longitudeColumn: string,
) {
  const pointCount = getDatasetPointCount(dataset);
  const sampleSize = Math.min(1_000, pointCount);
  let inspected = 0;
  let valid = 0;
  const rows = rowsFromDataset(dataset);

  for (let sampleIndex = 0; sampleIndex < sampleSize; sampleIndex += 1) {
    const index =
      sampleSize > 1 && pointCount > sampleSize
        ? Math.floor(
            (sampleIndex * (pointCount - 1)) /
              (sampleSize - 1),
          )
        : sampleIndex;
    const latitude =
      typeof dataset?.getValue === "function"
        ? dataset.getValue(latitudeColumn, index)
        : rowValue(rows[index], latitudeColumn, dataset);
    const longitude =
      typeof dataset?.getValue === "function"
        ? dataset.getValue(longitudeColumn, index)
        : rowValue(rows[index], longitudeColumn, dataset);

    if (latitude === undefined && longitude === undefined) {
      continue;
    }

    inspected += 1;
    const numericLatitude = Number(latitude);
    const numericLongitude = Number(longitude);
    if (
      Number.isFinite(numericLatitude) &&
      Number.isFinite(numericLongitude) &&
      numericLatitude >= -90 &&
      numericLatitude <= 90 &&
      numericLongitude >= -180 &&
      numericLongitude <= 180
    ) {
      valid += 1;
    }
  }

  return inspected > 0 ? valid / inspected : null;
}

export function getDatasetPointCount(dataset: any) {
  const dataContainer =
    dataset?.dataContainer ?? dataset?.data?.dataContainer;

  if (typeof dataContainer?.numRows === "function") {
    const count = Number(dataContainer.numRows());
    if (Number.isFinite(count)) {
      return Math.max(0, count);
    }
  }

  for (const candidate of [
    dataContainer?.numRows,
    typeof dataContainer?.getNumRows === "function"
      ? dataContainer.getNumRows()
      : undefined,
    dataset?.length,
    dataset?.data?.length,
    dataContainer?.length,
    rowsFromDataset(dataset).length,
  ]) {
    const count = Number(candidate);
    if (Number.isFinite(count) && count >= 0) {
      return count;
    }
  }

  return 0;
}

function geometryFromValue(value: any) {
  if (!value) {
    return null;
  }

  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }

  if (candidate?.type === "Feature") {
    return candidate.geometry;
  }
  if (
    isRecord(candidate) &&
    typeof candidate.type === "string" &&
    "coordinates" in candidate
  ) {
    return candidate;
  }
  if (isRecord(candidate?.geometry)) {
    return candidate.geometry;
  }

  return null;
}

function geometryFromRow(row: any) {
  const directGeometry = geometryFromValue(row);
  if (directGeometry) {
    return directGeometry;
  }

  if (isRecord(row) || Array.isArray(row)) {
    for (const value of Object.values(row)) {
      const geometry = geometryFromValue(value);
      if (geometry) {
        return geometry;
      }
    }
  }

  return null;
}

function inspectGeoJsonRows(
  dataset: any,
  geoJsonColumn: string | null,
) {
  let rows = rowsFromDataset(dataset);

  if (
    rows.length === 0 &&
    geoJsonColumn &&
    typeof dataset?.getValue === "function"
  ) {
    const rowCount = Math.min(
      2_500,
      getDatasetPointCount(dataset),
    );
    rows = Array.from({ length: rowCount }, (_, index) =>
      dataset.getValue(geoJsonColumn, index),
    );
  }

  const geometryTypes = new Set<string>();
  let inspected = 0;

  for (const row of rows.slice(0, 2_500)) {
    const geometry = geometryFromRow(row);
    if (typeof geometry?.type === "string") {
      geometryTypes.add(geometry.type);
      inspected += 1;
    }
  }

  return {
    inspected,
    onlyPoints:
      inspected > 0 &&
      geometryTypes.size === 1 &&
      geometryTypes.has("Point"),
  };
}

export function getPointClusterEligibility(
  layer: any,
  dataset: any,
  options: { minimumPointCount?: number } = {},
): PointClusterEligibility {
  const pointCount = getDatasetPointCount(dataset);
  const delivery =
    getAdaptivePointClusterDefaults(pointCount).delivery;
  const columns = resolveCoordinateColumns(layer, dataset);
  const geoJsonColumn =
    fieldName(layer?.config?.columns?.geojson) ??
    fieldName(layer?.columns?.geojson) ??
    null;
  const minimumPointCount =
    options.minimumPointCount ?? DEFAULT_MINIMUM_POINT_COUNT;
  const layerType = layer?.type;
  let sourceKind: PointClusterEligibility["sourceKind"] =
    "unsupported";

  if (layerType === "point") {
    sourceKind = "point";
  } else if (layerType === "geojson") {
    if (pointCount > MAX_CLIENT_POINT_COUNT) {
      return {
        eligible: false,
        reason: "tile_required",
        pointCount,
        delivery: "tile_required",
        ...columns,
        geoJsonColumn,
        sourceKind,
      };
    }
    const geoJsonInspection = inspectGeoJsonRows(
      dataset,
      geoJsonColumn,
    );
    if (!geoJsonInspection.onlyPoints) {
      return {
        eligible: false,
        reason: "mixed_geometry",
        pointCount,
        delivery,
        ...columns,
        geoJsonColumn,
        sourceKind,
      };
    }
    sourceKind = "geojson-point";
  } else {
    return {
      eligible: false,
      reason: "unsupported_layer",
      pointCount,
      delivery,
      ...columns,
      geoJsonColumn,
      sourceKind,
    };
  }

  if (pointCount > MAX_CLIENT_POINT_COUNT) {
    return {
      eligible: false,
      reason: "tile_required",
      pointCount,
      delivery: "tile_required",
      ...columns,
      geoJsonColumn,
      sourceKind,
    };
  }

  if (
    layer?.config?.readOnly === true ||
    layer?.config?.technicalReadOnly === true
  ) {
    return {
      eligible: false,
      reason: "technical_read_only",
      pointCount,
      delivery,
      ...columns,
      geoJsonColumn,
      sourceKind,
    };
  }

  if (layer?.config?.animation?.enabled === true) {
    return {
      eligible: false,
      reason: "temporal_animation",
      pointCount,
      delivery,
      ...columns,
      geoJsonColumn,
      sourceKind,
    };
  }

  if (
    (!columns.latitudeColumn ||
      !columns.longitudeColumn) &&
    !(sourceKind === "geojson-point" && geoJsonColumn)
  ) {
    return {
      eligible: false,
      reason: "missing_coordinates",
      pointCount,
      delivery,
      ...columns,
      geoJsonColumn,
      sourceKind,
    };
  }

  if (layer?.isValid === false) {
    return {
      eligible: false,
      reason: "invalid_coordinates",
      pointCount,
      delivery,
      ...columns,
      geoJsonColumn,
      sourceKind,
    };
  }

  if (
    columns.latitudeColumn &&
    columns.longitudeColumn
  ) {
    const validCoordinateRatio =
      inspectCoordinateValidity(
        dataset,
        columns.latitudeColumn,
        columns.longitudeColumn,
      );
    if (
      validCoordinateRatio !== null &&
      validCoordinateRatio < 0.9
    ) {
      return {
        eligible: false,
        reason: "invalid_coordinates",
        pointCount,
        delivery,
        ...columns,
        geoJsonColumn,
        sourceKind,
      };
    }
  }

  if (pointCount < minimumPointCount) {
    return {
      eligible: false,
      reason: "below_minimum",
      pointCount,
      delivery,
      ...columns,
      geoJsonColumn,
      sourceKind,
    };
  }

  return {
    eligible: true,
    reason: "eligible",
    pointCount,
    delivery,
    ...columns,
    geoJsonColumn,
    sourceKind,
  };
}
