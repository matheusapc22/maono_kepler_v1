const ANALYSIS_TYPES = new Set(["buffer.create", "isochrone.create"]);
const ISOCHRONE_MODES = new Set(["drive_traffic", "drive", "bicycle", "walk"]);
const ISOCHRONE_TYPES = new Set(["time", "distance"]);
const ISOCHRONE_MODE_SOURCES = new Set(["request", "profile", "default"]);
const MAX_FEATURES = 500;
const MAX_BUFFER_ITEMS = 100;
const MAX_BUFFER_RANGES = 4;
const MAX_ISOCHRONE_RANGES = 4;

function analysisError(message, code = "CHANGE_REQUEST_OPERATION_INVALID", details = null, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value) {
  return String(value ?? "").trim();
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function boundedNumber(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw analysisError(`${label} inválido.`);
  }
  return number;
}

function assertCoordinateTree(value, depth = 0) {
  if (!Array.isArray(value) || !value.length || depth > 8) {
    throw analysisError("Coordenadas GeoJSON inválidas.");
  }
  if (value.every((item) => typeof item === "number")) {
    if (value.length < 2) throw analysisError("Coordenada GeoJSON incompleta.");
    boundedNumber(value[0], -180, 180, "Longitude GeoJSON");
    boundedNumber(value[1], -90, 90, "Latitude GeoJSON");
    for (const item of value.slice(2)) {
      if (!Number.isFinite(Number(item))) throw analysisError("Componente GeoJSON inválido.");
    }
    return;
  }
  for (const child of value) assertCoordinateTree(child, depth + 1);
}

function assertGeometry(value) {
  if (!isRecord(value)) throw analysisError("Geometria GeoJSON inválida.");
  const type = text(value.type);
  if (type !== "Polygon" && type !== "MultiPolygon") {
    throw analysisError("A análise deve conter Polygon ou MultiPolygon.");
  }
  assertCoordinateTree(value.coordinates);
}

export function assertFrozenAnalysisGeoJson(value) {
  if (!isRecord(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) {
    throw analysisError("A análise deve conter uma FeatureCollection GeoJSON válida.");
  }
  if (value.features.length < 1 || value.features.length > MAX_FEATURES) {
    throw analysisError("Quantidade de feições da análise fora do limite permitido.");
  }
  for (const feature of value.features) {
    if (!isRecord(feature) || feature.type !== "Feature") {
      throw analysisError("Feature GeoJSON inválida.");
    }
    assertGeometry(feature.geometry);
    if (feature.properties != null && !isRecord(feature.properties)) {
      throw analysisError("Propriedades GeoJSON inválidas.");
    }
  }
  return value;
}

function assertCommonPayload(payload, kind) {
  if (!isRecord(payload)) throw analysisError("Payload de análise inválido.");
  if (payload.source !== "analysis" || payload.analysisKind !== kind) {
    throw analysisError("Origem/tipo da análise inválidos.");
  }
  for (const key of ["targetLayerId", "targetDataId", "targetLabel"]) {
    const value = text(payload[key]);
    if (!value || value.length > 200) throw analysisError(`${key} inválido.`);
  }
  if (!isRecord(payload.parameters)) throw analysisError("Parâmetros da análise inválidos.");
  assertFrozenAnalysisGeoJson(payload.geojson);
}

function assertOrigin(origin) {
  if (!isRecord(origin)) throw analysisError("Origem da análise inválida.");
  boundedNumber(origin.latitude, -90, 90, "Latitude da origem");
  boundedNumber(origin.longitude, -180, 180, "Longitude da origem");
}

export function assertBufferCreatePayload(payload) {
  assertCommonPayload(payload, "buffer");
  const items = payload.parameters.items;
  if (!Array.isArray(items) || items.length < 1 || items.length > MAX_BUFFER_ITEMS) {
    throw analysisError("Itens do Buffer inválidos.");
  }
  for (const candidate of items) {
    if (!isRecord(candidate)) throw analysisError("Item do Buffer inválido.");
    assertOrigin(candidate.origin);
    const unit = text(candidate.inputUnit);
    if (unit !== "m" && unit !== "km") throw analysisError("Unidade do Buffer inválida.");
    const ranges = candidate.ranges;
    const rangesMeters = candidate.rangesMeters;
    if (
      !Array.isArray(ranges) ||
      ranges.length < 1 ||
      ranges.length > MAX_BUFFER_RANGES ||
      !Array.isArray(rangesMeters) ||
      rangesMeters.length !== ranges.length
    ) {
      throw analysisError("Faixas do Buffer inválidas.");
    }
    for (const value of ranges) boundedNumber(value, Number.EPSILON, 200_000, "Faixa do Buffer");
    for (const value of rangesMeters) boundedNumber(value, Number.EPSILON, 200_000, "Raio do Buffer");
  }
}

export function assertIsochroneCreatePayload(payload) {
  assertCommonPayload(payload, "isochrone");
  assertOrigin(payload.parameters.origin);
  const metadata = payload.parameters.metadata;
  if (!isRecord(metadata)) throw analysisError("Metadados da isócrona inválidos.");
  if (!text(metadata.provider) || text(metadata.provider).length > 80) {
    throw analysisError("Provider da isócrona inválido.");
  }
  if (!ISOCHRONE_TYPES.has(text(metadata.type))) {
    throw analysisError("Tipo da isócrona inválido.");
  }
  if (!ISOCHRONE_MODES.has(text(metadata.mode))) {
    throw analysisError("Modo de deslocamento da isócrona inválido.");
  }
  if (!ISOCHRONE_MODE_SOURCES.has(text(metadata.mode_source))) {
    throw analysisError("Origem do modo da isócrona inválida.");
  }
  const ranges = metadata.ranges;
  if (!Array.isArray(ranges) || ranges.length < 1 || ranges.length > MAX_ISOCHRONE_RANGES) {
    throw analysisError("Faixas da isócrona inválidas.");
  }
  for (const value of ranges) boundedNumber(value, Number.EPSILON, 100_000, "Faixa da isócrona");
}

export function isFrozenAnalysisOperation(operation) {
  return ANALYSIS_TYPES.has(text(operation?.type));
}

export function validateFrozenAnalysisOperation(operation) {
  const type = text(operation?.type);
  if (!ANALYSIS_TYPES.has(type)) {
    throw analysisError("Operação de análise não suportada.", "CHANGE_REQUEST_OPERATION_UNSUPPORTED");
  }
  if (Number(operation?.version) !== 1) {
    throw analysisError(
      "Versão de operação de análise não suportada.",
      "CHANGE_REQUEST_OPERATION_VERSION_UNSUPPORTED",
    );
  }
  if (type === "buffer.create") assertBufferCreatePayload(operation.payload);
  else assertIsochroneCreatePayload(operation.payload);
}

function inferField(value, name) {
  const descriptor = { name, format: "" };
  if (typeof value === "number" && Number.isFinite(value)) {
    return { ...descriptor, type: "real", analyzerType: "FLOAT" };
  }
  if (typeof value === "boolean") {
    return { ...descriptor, type: "boolean", analyzerType: "BOOLEAN" };
  }
  return { ...descriptor, type: "string", analyzerType: "STRING" };
}

function cellValue(value) {
  if (value == null) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function ensureConfigCollections(config) {
  if (!isRecord(config)) {
    throw analysisError("Configuração-base inválida.", "CHANGE_REQUEST_BASE_CONFIG_INVALID", null, 409);
  }
  if (!Array.isArray(config.datasets)) config.datasets = [];
  if (!isRecord(config.config)) config.config = {};
  if (!isRecord(config.config.visState)) config.config.visState = {};
  if (!Array.isArray(config.config.visState.layers)) config.config.visState.layers = [];
  return { datasets: config.datasets, layers: config.config.visState.layers };
}

function datasetId(dataset) {
  return text(dataset?.data?.id ?? dataset?.info?.id ?? dataset?.id);
}

function layerId(layer) {
  return text(layer?.id);
}

function frozenGeoJsonDataset(payload) {
  const features = payload.geojson.features;
  const propertyKeys = [];
  const keySet = new Set();
  const samples = new Map();
  for (const feature of features) {
    const properties = isRecord(feature.properties) ? feature.properties : {};
    for (const [key, value] of Object.entries(properties)) {
      if (!keySet.has(key)) {
        keySet.add(key);
        propertyKeys.push(key);
      }
      if (!samples.has(key) && value != null) samples.set(key, value);
    }
  }
  const fields = [
    { name: "_geojson", format: "", type: "geojson", analyzerType: "GEOMETRY" },
    ...propertyKeys.map((key) => inferField(samples.get(key), key)),
  ];
  const rows = features.map((feature) => {
    const properties = isRecord(feature.properties) ? feature.properties : {};
    return [
      cloneJson(feature.geometry),
      ...propertyKeys.map((key) => cellValue(properties[key])),
    ];
  });
  return {
    version: "v1",
    data: {
      id: text(payload.targetDataId),
      label: text(payload.targetLabel),
      color: [197, 160, 89],
      allData: rows,
      fields,
    },
  };
}

function frozenGeoJsonLayer(payload) {
  const isBuffer = payload.analysisKind === "buffer";
  return {
    id: text(payload.targetLayerId),
    type: "geojson",
    config: {
      dataId: text(payload.targetDataId),
      label: text(payload.targetLabel),
      color: [197, 160, 89],
      columns: { geojson: "_geojson" },
      isVisible: true,
      visConfig: {
        opacity: isBuffer ? 0.2 : 0.28,
        filled: true,
        stroked: true,
        strokeColor: [183, 121, 31],
        strokeOpacity: 0.95,
        thickness: 1.5,
      },
    },
    visualChannels: {
      colorField: null,
      colorScale: "quantile",
      sizeField: null,
      sizeScale: "linear",
      strokeColorField: null,
      strokeColorScale: "quantile",
      heightField: null,
      heightScale: "linear",
      radiusField: null,
      radiusScale: "linear",
    },
  };
}

function operationFocus(payload) {
  if (payload.analysisKind === "isochrone") return payload.parameters.origin;
  return payload.parameters.items?.[0]?.origin || null;
}

function projection(operation, payload) {
  const focus = operationFocus(payload);
  const properties = payload.analysisKind === "buffer"
    ? {
        itemCount: payload.parameters.items.length,
        items: cloneJson(payload.parameters.items),
      }
    : {
        origin: cloneJson(payload.parameters.origin),
        metadata: cloneJson(payload.parameters.metadata),
      };
  return {
    id: text(operation.id),
    sequence: Number(operation.sequence ?? 0),
    type: text(operation.type),
    version: 1,
    label: text(payload.targetLabel),
    focus: focus
      ? {
          latitude: Number(focus.latitude),
          longitude: Number(focus.longitude),
        }
      : null,
    target: {
      layerId: text(payload.targetLayerId),
      dataId: text(payload.targetDataId),
      label: text(payload.targetLabel),
    },
    overlay: {
      kind: "geojson",
      geojson: cloneJson(payload.geojson),
    },
    properties,
  };
}

export function applyFrozenAnalysisOperation(config, operation) {
  validateFrozenAnalysisOperation(operation);
  const payload = operation.payload;
  const collections = ensureConfigCollections(config);
  const dataId = text(payload.targetDataId);
  const targetLayerId = text(payload.targetLayerId);
  if (collections.datasets.some((dataset) => datasetId(dataset) === dataId)) {
    throw analysisError(
      "O dataset proposto para a análise já existe na revisão-base/proposta.",
      "CHANGE_REQUEST_OPERATION_TARGET_INVALID",
      { dataId },
      409,
    );
  }
  if (collections.layers.some((layer) => layerId(layer) === targetLayerId)) {
    throw analysisError(
      "A camada proposta para a análise já existe na revisão-base/proposta.",
      "CHANGE_REQUEST_OPERATION_TARGET_INVALID",
      { layerId: targetLayerId },
      409,
    );
  }
  collections.datasets.push(frozenGeoJsonDataset(payload));
  collections.layers.push(frozenGeoJsonLayer(payload));
  return projection(operation, payload);
}
