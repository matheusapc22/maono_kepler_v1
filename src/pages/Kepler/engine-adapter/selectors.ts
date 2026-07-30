import type {
  KeplerEngineState,
  MapBounds,
  MapColorScale,
  MapDatasetField,
  MapDatasetSummary,
  MapFilterDomainValue,
  MapFilterHistogramBin,
  MapFilterSummary,
  MapFilterType,
  MapLayerStyle,
  MapLayerSummary,
  MapRgbColor,
  MapTooltipConfig,
  MapTooltipField,
  MapViewportSummary,
} from "./types.ts";

export const KEPLER_MAP_ID = "map";
const MAX_BOUNDS_ROWS = 50_000;
const MAX_FILTER_DOMAIN_VALUES = 5_000;
const MAX_FILTER_HISTOGRAM_BINS = 80;
const DEFAULT_COLOR: MapRgbColor = [47, 125, 244];
const DEFAULT_STROKE_COLOR: MapRgbColor = [47, 125, 244];

type AnyRecord = Record<string, any>;

export function collectionToArray<T = any>(value: unknown): T[] {
  if (Array.isArray(value)) return value;

  if (
    value &&
    typeof value === "object" &&
    typeof (value as any).toArray === "function"
  ) {
    return (value as any).toArray();
  }

  if (
    value &&
    typeof value !== "string" &&
    typeof (value as any)[Symbol.iterator] === "function"
  ) {
    return Array.from(value as Iterable<T>);
  }

  return [];
}

export function readValue(value: unknown, key: string): any {
  if (!value || typeof value !== "object") return undefined;

  if (typeof (value as any).get === "function") {
    return (value as any).get(key);
  }

  return (value as AnyRecord)[key];
}

function toPlainRecord(value: unknown): AnyRecord {
  if (!value || typeof value !== "object") return {};

  if (typeof (value as any).toJS === "function") {
    const result = (value as any).toJS();
    return result && typeof result === "object" ? result : {};
  }

  return value as AnyRecord;
}

function finiteNumber(
  value: unknown,
  fallback: number,
  minimum?: number,
  maximum?: number,
) {
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? parsed : fallback;

  return Math.min(
    maximum ?? Number.POSITIVE_INFINITY,
    Math.max(minimum ?? Number.NEGATIVE_INFINITY, normalized),
  );
}

function normalizedColor(
  value: unknown,
  fallback: MapRgbColor = DEFAULT_COLOR,
): MapRgbColor {
  const values = collectionToArray<number>(value);

  if (values.length < 3) return [...fallback] as MapRgbColor;

  return [
    Math.round(finiteNumber(values[0], fallback[0], 0, 255)),
    Math.round(finiteNumber(values[1], fallback[1], 0, 255)),
    Math.round(finiteNumber(values[2], fallback[2], 0, 255)),
  ];
}

function normalizedDataIds(value: unknown): string[] {
  const collection = collectionToArray<unknown>(value);
  const values = collection.length
    ? collection
    : value == null
      ? []
      : [value];

  return Array.from(
    new Set(values.map((item) => String(item ?? "").trim()).filter(Boolean)),
  );
}

function normalizedFieldName(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;

  const name = readValue(value, "name") ?? readValue(value, "value");
  return typeof name === "string" ? name.trim() || null : null;
}

function normalizedPalette(value: unknown): string[] {
  const colors = readValue(value, "colors") ?? value;

  return collectionToArray<unknown>(colors)
    .map((color) => String(color ?? "").trim())
    .filter((color) => /^#[0-9a-f]{6}$/i.test(color));
}

function normalizedColorScale(value: unknown): MapColorScale | null {
  return value === "quantile" ||
    value === "quantize" ||
    value === "linear" ||
    value === "ordinal"
    ? value
    : null;
}

function layerStyle(layer: any): MapLayerStyle {
  const config = toPlainRecord(readValue(layer, "config"));
  const visConfig = toPlainRecord(config.visConfig);

  return {
    fillEnabled: visConfig.filled !== false,
    opacity: finiteNumber(visConfig.opacity, 0.8, 0, 1),
    color: normalizedColor(config.color),
    colorField: normalizedFieldName(
      config.colorField ?? readValue(layer, "colorField"),
    ),
    colorScale: normalizedColorScale(visConfig.colorScale),
    colorPalette: normalizedPalette(visConfig.colorRange),
    strokeEnabled:
      visConfig.stroked === true || visConfig.outline === true,
    strokeColor: normalizedColor(visConfig.strokeColor, DEFAULT_STROKE_COLOR),
    strokeColorField: normalizedFieldName(
      config.strokeColorField ?? readValue(layer, "strokeColorField"),
    ),
    strokeColorScale: normalizedColorScale(visConfig.strokeColorScale),
    strokeColorPalette: normalizedPalette(visConfig.strokeColorRange),
    strokeOpacity: finiteNumber(visConfig.strokeOpacity, 1, 0, 1),
    strokeWidth: finiteNumber(
      visConfig.thickness ?? visConfig.strokeWidth,
      1,
      0,
    ),
    pointRadius:
      visConfig.radius == null ? null : finiteNumber(visConfig.radius, 10, 0),
    clusterRadius:
      visConfig.clusterRadius == null
        ? null
        : finiteNumber(visConfig.clusterRadius, 40, 0),
    heatmapRadius:
      visConfig.heatmapRadius == null
        ? visConfig.radius == null
          ? null
          : finiteNumber(visConfig.radius, 20, 0)
        : finiteNumber(visConfig.heatmapRadius, 20, 0),
  };
}

function layerId(layer: any) {
  return String(readValue(layer, "id") ?? "").trim();
}

function orderedLayers(value: unknown, layerOrder?: unknown) {
  const layers = collectionToArray<any>(value).filter((layer) =>
    Boolean(layerId(layer)),
  );
  const order = collectionToArray<unknown>(layerOrder)
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);

  if (!order.length) return layers;

  const byId = new Map(layers.map((layer) => [layerId(layer), layer]));
  const ordered = order.map((id) => byId.get(id)).filter(Boolean) as any[];
  const remaining = layers.filter((layer) => !order.includes(layerId(layer)));

  return [...ordered, ...remaining];
}

export function normalizeKeplerLayers(
  value: unknown,
  layerOrder?: unknown,
): MapLayerSummary[] {
  return orderedLayers(value, layerOrder).map((layer) => {
    const config = toPlainRecord(readValue(layer, "config"));
    const id = layerId(layer);

    return {
      id,
      type: String(readValue(layer, "type") || "layer"),
      label: String(config.label || id),
      isVisible: config.isVisible !== false,
      dataIds: normalizedDataIds(config.dataId ?? readValue(layer, "dataId")),
      style: layerStyle(layer),
    };
  });
}

function normalizedField(field: any): MapDatasetField | null {
  const name = String(readValue(field, "name") ?? "").trim();

  if (!name) return null;

  const type =
    readValue(field, "type") ??
    readValue(field, "dataType") ??
    readValue(field, "analyzerType");
  const format = readValue(field, "format");

  return {
    name,
    type: type == null ? null : String(type),
    format: format == null ? null : String(format),
    filterType: filterTypeForFieldType(type),
  };
}

export function filterTypeForFieldType(
  value: unknown,
): Exclude<MapFilterType, "polygon" | "unknown"> | null {
  const type = String(value ?? "")
    .trim()
    .toLocaleLowerCase();

  if (
    type.includes("timestamp") ||
    type.includes("datetime") ||
    type === "time"
  ) {
    return "timeRange";
  }
  if (type.includes("bool")) return "select";
  if (
    type.includes("number") ||
    type.includes("integer") ||
    type === "int" ||
    type.includes("float") ||
    type.includes("double") ||
    type.includes("decimal") ||
    type.includes("real")
  ) {
    return "range";
  }
  if (
    !type ||
    type.includes("string") ||
    type.includes("text") ||
    type.includes("varchar") ||
    type.includes("category") ||
    type.includes("h3") ||
    type === "date"
  ) {
    return "multiSelect";
  }

  return null;
}

function datasetEntries(value: unknown): Array<[string, any]> {
  if (!value || typeof value !== "object") return [];

  if (typeof (value as any).entrySeq === "function") {
    return (value as any).entrySeq().toArray();
  }

  if (value instanceof Map) {
    return Array.from(value.entries());
  }

  return Object.entries(value as AnyRecord);
}

function datasetRowCount(dataset: any): number | null {
  const allIndexes = collectionToArray(readValue(dataset, "allIndexes"));

  if (allIndexes.length) return allIndexes.length;

  const dataContainer = readValue(dataset, "dataContainer");
  const numRows =
    readValue(dataContainer, "numRows") ?? readValue(dataContainer, "length");

  if (Number.isFinite(Number(numRows))) return Number(numRows);

  const rawRows = readValue(dataset, "allData");
  const rows = collectionToArray(rawRows);

  if (Array.isArray(rawRows) || rows.length) {
    return rows.length;
  }

  return null;
}

function datasetFilteredRowCount(dataset: any): number | null {
  const filteredIndex = readValue(dataset, "filteredIndex");
  if (filteredIndex == null) return null;

  return collectionToArray(filteredIndex).length;
}

export function normalizeKeplerDatasets(
  value: unknown,
  visibleDatasetIds: Iterable<string> = [],
): MapDatasetSummary[] {
  const visible = new Set(visibleDatasetIds);

  return datasetEntries(value).map(([key, dataset]) => {
    const info = readValue(dataset, "info");
    const id = String(readValue(dataset, "id") ?? key);
    const fields = collectionToArray(
      readValue(dataset, "fields") ??
        readValue(readValue(dataset, "data"), "fields"),
    )
      .map(normalizedField)
      .filter((field): field is MapDatasetField => Boolean(field));

    const rowCount = datasetRowCount(dataset);

    return {
      id,
      label: String(
        readValue(dataset, "label") ?? readValue(info, "label") ?? id,
      ),
      fields,
      rowCount,
      filteredRowCount: datasetFilteredRowCount(dataset),
      isVisible: visible.has(id),
    };
  });
}

function normalizedFilterType(value: unknown): MapFilterType {
  switch (String(value ?? "")) {
    case "range":
      return "range";
    case "timeRange":
      return "timeRange";
    case "multiSelect":
      return "multiSelect";
    case "select":
      return "select";
    case "polygon":
      return "polygon";
    default:
      return "unknown";
  }
}

function isFilterDomainValue(
  value: unknown,
): value is MapFilterDomainValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function normalizedFilterDomain(value: unknown, type: MapFilterType) {
  const values = collectionToArray<unknown>(value).filter(isFilterDomainValue);
  const domainSize = values.length;
  const limit =
    type === "multiSelect" ? MAX_FILTER_DOMAIN_VALUES : Math.min(2, domainSize);

  return {
    domain: values.slice(0, limit),
    domainSize,
    domainTruncated: domainSize > limit,
  };
}

function normalizedFilterValue(
  value: unknown,
  type: MapFilterType,
): unknown {
  if (type === "range" || type === "timeRange") {
    const values = collectionToArray<unknown>(value)
      .slice(0, 2)
      .map(Number);
    return values.length === 2 && values.every(Number.isFinite)
      ? values
      : null;
  }
  if (type === "multiSelect") {
    return collectionToArray<unknown>(value)
      .filter(isFilterDomainValue)
      .slice(0, MAX_FILTER_DOMAIN_VALUES);
  }
  if (type === "select") {
    if (typeof value === "boolean") return value;
    const first = collectionToArray<unknown>(value)[0];
    return typeof first === "boolean" ? first : null;
  }

  return null;
}

function normalizedHistogramBin(value: unknown): MapFilterHistogramBin | null {
  const start = Number(
    readValue(value, "start") ??
      readValue(value, "x0") ??
      readValue(value, "value") ??
      readValue(value, "x"),
  );
  const end = Number(
    readValue(value, "end") ??
      readValue(value, "x1") ??
      readValue(value, "value") ??
      readValue(value, "x"),
  );
  const count = Number(
    readValue(value, "count") ??
      readValue(value, "y") ??
      readValue(value, "valueCount"),
  );

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(count) ||
    end < start ||
    count < 0
  ) {
    return null;
  }

  return { start, end, count };
}

function compactHistogram(
  bins: MapFilterHistogramBin[],
): MapFilterHistogramBin[] {
  if (bins.length <= MAX_FILTER_HISTOGRAM_BINS) return bins;

  const bucketSize = Math.ceil(bins.length / MAX_FILTER_HISTOGRAM_BINS);
  const compacted: MapFilterHistogramBin[] = [];

  for (let index = 0; index < bins.length; index += bucketSize) {
    const bucket = bins.slice(index, index + bucketSize);
    const first = bucket[0];
    const last = bucket[bucket.length - 1];
    if (!first || !last) continue;

    compacted.push({
      start: first.start,
      end: last.end,
      count: bucket.reduce((total, bin) => total + bin.count, 0),
    });
  }

  return compacted;
}

function normalizedFilterHistogram(filter: any, dataIds: string[]) {
  const bins = readValue(filter, "bins");
  const datasetBins =
    dataIds.length === 1 ? readValue(bins, dataIds[0]) ?? bins : bins;
  const lineChartSeries = readValue(
    readValue(filter, "lineChart"),
    "series",
  );
  const source = collectionToArray(
    collectionToArray(datasetBins).length ? datasetBins : lineChartSeries,
  );

  return compactHistogram(
    source
      .map(normalizedHistogramBin)
      .filter((bin): bin is MapFilterHistogramBin => Boolean(bin)),
  );
}

function filterCompatibility(
  type: MapFilterType,
  dataIds: string[],
  fieldNames: string[],
  domain: MapFilterDomainValue[],
) {
  if (dataIds.length !== 1) {
    return "Filtros sincronizados entre bases devem ser editados no painel nativo do Kepler.";
  }
  if (fieldNames.length !== 1) {
    return "O filtro não possui uma única propriedade editável.";
  }
  if (type === "polygon") {
    return "Filtros espaciais devem ser editados no painel nativo do Kepler.";
  }
  if (type === "unknown") {
    return "Este tipo de filtro não é compatível com o painel Maõno.";
  }
  if (
    (type === "range" ||
      type === "timeRange" ||
      type === "multiSelect") &&
    !domain.length
  ) {
    return "O Kepler ainda não calculou o domínio deste filtro.";
  }

  return null;
}

export function normalizeKeplerFilters(value: unknown): MapFilterSummary[] {
  return collectionToArray<any>(value).map((filter, index) => {
    const id = String(readValue(filter, "id") || `filter-${index}`);
    const dataIds = normalizedDataIds(readValue(filter, "dataId"));
    const fieldNames = normalizedDataIds(readValue(filter, "name"));
    const type = normalizedFilterType(readValue(filter, "type"));
    const { domain, domainSize, domainTruncated } = normalizedFilterDomain(
      readValue(filter, "domain"),
      type,
    );
    const compatibilityReason = filterCompatibility(
      type,
      dataIds,
      fieldNames,
      domain,
    );
    const rawStep = Number(readValue(filter, "step"));

    return {
      id,
      index,
      dataIds,
      fieldNames,
      type,
      fieldType:
        readValue(filter, "fieldType") == null
          ? null
          : String(readValue(filter, "fieldType")),
      domain,
      domainSize,
      domainTruncated,
      step: Number.isFinite(rawStep) && rawStep > 0 ? rawStep : null,
      histogram: normalizedFilterHistogram(filter, dataIds),
      value: normalizedFilterValue(readValue(filter, "value"), type),
      enabled: readValue(filter, "enabled") !== false,
      compatible: compatibilityReason === null,
      compatibilityReason,
    };
  });
}

function normalizedTooltipFields(value: unknown): MapTooltipField[] {
  return collectionToArray<any>(value)
    .map((field) => {
      const name = String(readValue(field, "name") ?? "").trim();

      if (!name) return null;

      const format = readValue(field, "format");
      return {
        name,
        format: format == null ? null : String(format),
      };
    })
    .filter((field): field is MapTooltipField => Boolean(field));
}

function recordEntries(value: unknown): Array<[string, any]> {
  if (!value || typeof value !== "object") return [];

  if (typeof (value as any).entrySeq === "function") {
    return (value as any).entrySeq().toArray();
  }

  if (value instanceof Map) return Array.from(value.entries());
  return Object.entries(value as AnyRecord);
}

export function normalizeKeplerTooltip(
  interactionConfig: unknown,
): MapTooltipConfig {
  const tooltip = readValue(interactionConfig, "tooltip");
  const config = readValue(tooltip, "config");
  const fieldsToShow = readValue(config, "fieldsToShow");

  return {
    enabled: readValue(tooltip, "enabled") !== false,
    fieldsByDataset: Object.fromEntries(
      recordEntries(fieldsToShow).map(([datasetId, fields]) => [
        datasetId,
        normalizedTooltipFields(fields),
      ]),
    ),
  };
}

export function mapLegendVisible(mapState: unknown) {
  const uiState = readValue(mapState, "uiState");
  const mapControls = readValue(uiState, "mapControls");
  const mapLegend = readValue(mapControls, "mapLegend");

  return readValue(mapLegend, "active") === true;
}

export function normalizeKeplerViewport(
  value: unknown,
): MapViewportSummary | null {
  const viewport = toPlainRecord(value);
  const required = [
    "longitude",
    "latitude",
    "zoom",
    "width",
    "height",
  ] as const;

  if (required.some((key) => !Number.isFinite(Number(viewport[key])))) {
    return null;
  }

  return {
    longitude: Number(viewport.longitude),
    latitude: Number(viewport.latitude),
    zoom: Number(viewport.zoom),
    bearing: finiteNumber(viewport.bearing, 0),
    pitch: finiteNumber(viewport.pitch, 0),
    width: Math.max(0, Number(viewport.width)),
    height: Math.max(0, Number(viewport.height)),
  };
}

export function selectKeplerMapState(rootState: any) {
  return (
    rootState?.demo?.keplerGl?.[KEPLER_MAP_ID] ??
    rootState?.keplerGl?.[KEPLER_MAP_ID] ??
    null
  );
}

export function selectKeplerVisState(rootState: any) {
  return selectKeplerMapState(rootState)?.visState ?? null;
}

export function selectKeplerUiState(rootState: any) {
  return selectKeplerMapState(rootState)?.uiState ?? null;
}

export function selectKeplerViewportState(rootState: any) {
  return selectKeplerMapState(rootState)?.mapState ?? null;
}

export function selectKeplerIsLoading(rootState: any) {
  return rootState?.demo?.app?.isMapLoading === true;
}

export function selectKeplerError(rootState: any): string | null {
  const error = rootState?.demo?.app?.error;

  if (!error) return null;
  if (typeof error === "string") return error;

  const message = readValue(error, "message");
  return message == null ? "Falha no runtime do mapa." : String(message);
}

export function findRawLayer(rootState: any, id: string) {
  return collectionToArray<any>(
    readValue(selectKeplerVisState(rootState), "layers"),
  ).find((layer) => layerId(layer) === id);
}

export function findRawDataset(rootState: any, id: string) {
  return datasetEntries(
    readValue(selectKeplerVisState(rootState), "datasets"),
  ).find(
    ([key, dataset]) => String(readValue(dataset, "id") ?? key) === id,
  )?.[1];
}

export function findRawFilter(rootState: any, index: number) {
  return collectionToArray<any>(
    readValue(selectKeplerVisState(rootState), "filters"),
  )[index];
}

export function filterableFields(dataset: any): MapDatasetField[] {
  return collectionToArray(
    readValue(dataset, "fields") ??
      readValue(readValue(dataset, "data"), "fields"),
  )
    .map(normalizedField)
    .filter(
      (field): field is MapDatasetField => Boolean(field?.filterType),
    );
}

export function firstFilterableDataset(rootState: any) {
  for (const [key, dataset] of datasetEntries(
    readValue(selectKeplerVisState(rootState), "datasets"),
  )) {
    const fields = filterableFields(dataset);
    if (!fields.length) continue;

    return {
      id: String(readValue(dataset, "id") ?? key),
      field: fields[0],
    };
  }

  return null;
}

function columnName(value: unknown) {
  if (typeof value === "string") return value;
  return String(readValue(value, "value") ?? "").trim();
}

function datasetFieldIndex(dataset: any, name: string) {
  return collectionToArray(
    readValue(dataset, "fields") ??
      readValue(readValue(dataset, "data"), "fields"),
  ).findIndex((field) => String(readValue(field, "name") ?? "") === name);
}

function datasetIndexes(dataset: any, filteredOnly: boolean) {
  const filteredIndex = readValue(dataset, "filteredIndex");
  const filtered = collectionToArray<number>(filteredIndex);
  const all = collectionToArray<number>(readValue(dataset, "allIndexes"));

  if (filteredOnly && filteredIndex != null) return filtered;
  if (all.length) return all;

  const rows = collectionToArray(readValue(dataset, "allData"));
  return rows.map((_, index) => index);
}

function datasetCell(dataset: any, rowIndex: number, fieldIndex: number) {
  const dataContainer = readValue(dataset, "dataContainer");

  if (typeof dataContainer?.valueAt === "function") {
    return dataContainer.valueAt(rowIndex, fieldIndex);
  }

  const row = collectionToArray<any>(readValue(dataset, "allData"))[rowIndex];
  if (Array.isArray(row)) return row[fieldIndex];

  const fields = collectionToArray<any>(readValue(dataset, "fields"));
  const fieldName = String(readValue(fields[fieldIndex], "name") ?? "");
  return row && typeof row === "object" ? row[fieldName] : undefined;
}

type MutableBounds = {
  minLongitude: number;
  minLatitude: number;
  maxLongitude: number;
  maxLatitude: number;
  points: number;
  sampled: boolean;
};

function addCoordinate(
  bounds: MutableBounds,
  longitude: unknown,
  latitude: unknown,
) {
  if (bounds.points >= MAX_BOUNDS_ROWS) {
    bounds.sampled = true;
    return;
  }

  const lng = Number(longitude);
  const lat = Number(latitude);

  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    lng < -180 ||
    lng > 180 ||
    lat < -90 ||
    lat > 90
  ) {
    return;
  }

  bounds.minLongitude = Math.min(bounds.minLongitude, lng);
  bounds.maxLongitude = Math.max(bounds.maxLongitude, lng);
  bounds.minLatitude = Math.min(bounds.minLatitude, lat);
  bounds.maxLatitude = Math.max(bounds.maxLatitude, lat);
  bounds.points += 1;
}

function visitCoordinates(bounds: MutableBounds, coordinates: unknown) {
  if (bounds.points >= MAX_BOUNDS_ROWS) {
    bounds.sampled = true;
    return;
  }

  if (
    Array.isArray(coordinates) &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    addCoordinate(bounds, coordinates[0], coordinates[1]);
    return;
  }

  if (Array.isArray(coordinates)) {
    for (const child of coordinates) {
      visitCoordinates(bounds, child);
      if (bounds.points >= MAX_BOUNDS_ROWS) break;
    }
  }
}

function visitGeometry(bounds: MutableBounds, value: unknown) {
  let geometry = value;

  if (typeof geometry === "string") {
    try {
      geometry = JSON.parse(geometry);
    } catch {
      return;
    }
  }

  const normalized = toPlainRecord(geometry);
  const nestedGeometry = normalized.geometry;
  const coordinates =
    readValue(nestedGeometry, "coordinates") ?? normalized.coordinates;

  visitCoordinates(bounds, coordinates);
}

export function calculateKeplerBounds(
  rootOrVisState: any,
  {
    filteredOnly = false,
  }: {
    filteredOnly?: boolean;
  } = {},
): MapBounds | null {
  const visState =
    rootOrVisState?.demo || rootOrVisState?.keplerGl
      ? selectKeplerVisState(rootOrVisState)
      : rootOrVisState;
  const rawLayers = collectionToArray<any>(readValue(visState, "layers"));
  const rawDatasets = readValue(visState, "datasets");
  const byId = new Map(
    datasetEntries(rawDatasets).map(([key, dataset]) => [
      String(readValue(dataset, "id") ?? key),
      dataset,
    ]),
  );
  const bounds: MutableBounds = {
    minLongitude: 180,
    minLatitude: 90,
    maxLongitude: -180,
    maxLatitude: -90,
    points: 0,
    sampled: false,
  };

  for (const layer of rawLayers) {
    const config = toPlainRecord(readValue(layer, "config"));
    const type = String(readValue(layer, "type") ?? "");

    if (config.isVisible === false) continue;
    if (!["point", "cluster", "heatmap", "geojson"].includes(type)) {
      continue;
    }

    const dataId = normalizedDataIds(config.dataId)[0];
    const dataset = dataId ? byId.get(dataId) : null;
    if (!dataset) continue;

    const indexes = datasetIndexes(dataset, filteredOnly);
    const limitedIndexes = indexes.slice(0, MAX_BOUNDS_ROWS);
    if (indexes.length > limitedIndexes.length) bounds.sampled = true;

    if (type === "geojson") {
      const geojsonField = columnName(config.columns?.geojson);
      const geojsonIndex = datasetFieldIndex(dataset, geojsonField);
      if (geojsonIndex < 0) continue;

      for (const rowIndex of limitedIndexes) {
        visitGeometry(bounds, datasetCell(dataset, rowIndex, geojsonIndex));
        if (bounds.points >= MAX_BOUNDS_ROWS) break;
      }
      continue;
    }

    const latitudeField = columnName(config.columns?.lat);
    const longitudeField = columnName(config.columns?.lng);
    const latitudeIndex = datasetFieldIndex(dataset, latitudeField);
    const longitudeIndex = datasetFieldIndex(dataset, longitudeField);

    if (latitudeIndex < 0 || longitudeIndex < 0) continue;

    for (const rowIndex of limitedIndexes) {
      addCoordinate(
        bounds,
        datasetCell(dataset, rowIndex, longitudeIndex),
        datasetCell(dataset, rowIndex, latitudeIndex),
      );
      if (bounds.points >= MAX_BOUNDS_ROWS) break;
    }
  }

  if (!bounds.points) return null;

  const latitudePadding = bounds.minLatitude === bounds.maxLatitude ? 0.02 : 0;
  const longitudePadding =
    bounds.minLongitude === bounds.maxLongitude ? 0.02 : 0;
  const rounded = (value: number) => Number(value.toFixed(12));

  return {
    minLongitude: rounded(bounds.minLongitude - longitudePadding),
    minLatitude: rounded(bounds.minLatitude - latitudePadding),
    maxLongitude: rounded(bounds.maxLongitude + longitudePadding),
    maxLatitude: rounded(bounds.maxLatitude + latitudePadding),
    sampled: bounds.sampled,
  };
}

function visStateSlice(visState: any) {
  const rawLayers = readValue(visState, "layers");
  const layers = normalizeKeplerLayers(
    rawLayers,
    readValue(visState, "layerOrder"),
  );
  const visibleLayerIds = layers
    .filter((layer) => layer.isVisible)
    .map((layer) => layer.id);
  const visibleDatasetIds = Array.from(
    new Set(
      layers
        .filter((layer) => layer.isVisible)
        .flatMap((layer) => layer.dataIds),
    ),
  );

  return {
    layers,
    filters: normalizeKeplerFilters(readValue(visState, "filters")),
    datasets: normalizeKeplerDatasets(
      readValue(visState, "datasets"),
      visibleDatasetIds,
    ),
    tooltip: normalizeKeplerTooltip(readValue(visState, "interactionConfig")),
    visibleLayerIds,
    visibleDatasetIds,
    bounds: calculateKeplerBounds(visState),
    filteredBounds: calculateKeplerBounds(visState, {
      filteredOnly: true,
    }),
  };
}

export function createKeplerEngineSelector() {
  let previousVisState: any = Symbol("initial");
  let previousVisSlice: ReturnType<typeof visStateSlice> | null = null;
  let previousViewportState: any = Symbol("initial");
  let previousViewport: MapViewportSummary | null = null;
  let previousMapState: any = Symbol("initial");
  let previousSelectedLayerId: string | null = null;
  let previousLoading = false;
  let previousError: string | null = null;
  let previousResult: KeplerEngineState | null = null;

  return (
    rootState: any,
    selectedLayerId: string | null = null,
  ): KeplerEngineState => {
    const mapState = selectKeplerMapState(rootState);
    const visState = mapState?.visState ?? null;
    const viewportState = mapState?.mapState ?? null;
    const isLoading = selectKeplerIsLoading(rootState);
    const error = selectKeplerError(rootState);

    if (
      previousResult &&
      mapState === previousMapState &&
      selectedLayerId === previousSelectedLayerId &&
      isLoading === previousLoading &&
      error === previousError
    ) {
      return previousResult;
    }

    if (visState !== previousVisState || !previousVisSlice) {
      previousVisState = visState;
      previousVisSlice = visStateSlice(visState);
    }

    if (viewportState !== previousViewportState) {
      previousViewportState = viewportState;
      previousViewport = normalizeKeplerViewport(viewportState);
    }

    const selectedExists = previousVisSlice.layers.some(
      (layer) => layer.id === selectedLayerId,
    );

    previousMapState = mapState;
    previousSelectedLayerId = selectedLayerId;
    previousLoading = isLoading;
    previousError = error;
    previousResult = {
      mapId: KEPLER_MAP_ID,
      ready: Boolean(mapState) && !isLoading && !error,
      isLoading,
      error,
      selectedLayerId: selectedExists
        ? selectedLayerId
        : (previousVisSlice.layers[0]?.id ?? null),
      ...previousVisSlice,
      legendVisible: mapLegendVisible(mapState),
      viewport: previousViewport,
      transientDatasetIds: [],
      hasData: previousVisSlice.datasets.length > 0,
      hasUnsavedChanges: false,
    };

    return previousResult;
  };
}
