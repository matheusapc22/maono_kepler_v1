const ANALYSIS_TYPES = new Set(["buffer.create", "isochrone.create"]);
const ISOCHRONE_MODES = new Set(["drive_traffic", "drive", "bicycle", "walk"]);
const MAX_BUFFER_RADIUS_METERS = 1_000_000;
const MAX_ISOCHRONE_MINUTES = 240;
const MAX_ISOCHRONE_RANGES = 12;
const MAX_FEATURES = 10_000;

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

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw analysisError(`${label} inválido.`);
  }
  return number;
}

function coordinate(value, minimum, maximum, label) {
  const number = finiteNumber(value, label);
  if (number < minimum || number > maximum) {
    throw analysisError(`${label} fora do intervalo permitido.`);
  }
  return number;
}

function assertOrigin(value) {
  if (!isRecord(value)) {
    throw analysisError("Origem da análise inválida.");
  }
  const kind = text(value.kind);
  if (kind !== "point" && kind !== "feature") {
    throw analysisError("Tipo de origem da análise inválido.");
  }
  coordinate(value.longitude, -180, 180, "Longitude da origem");
  coordinate(value.latitude, -90, 90, "Latitude da origem");
  if (kind === "feature") {
    if (!text(value.dataId)) throw analysisError("Origem por feição sem dataId.");
    const index = Number(value.featureIndex);
    if (!Number.isInteger(index) || index < 0) {
      throw analysisError("Índice da feição de origem inválido.");
    }
  }
}

function assertCoordinateTree(value, depth = 0) {
  if (!Array.isArray(value) || !value.length || depth > 8) {
    throw analysisError("Coordenadas GeoJSON inválidas.");
  }
  if (value.every((item) => typeof item === "number")) {
    if (value.length < 2) throw analysisError("Coordenada GeoJSON incompleta.");
    coordinate(value[0], -180, 180, "Longitude GeoJSON");
    coordinate(value[1], -90, 90, "Latitude GeoJSON");
    for (const item of value.slice(2)) finiteNumber(item, "Componente GeoJSON");
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

function assertCommonPayload(payload) {
  if (!isRecord(payload)) throw analysisError("Payload de análise inválido.");
  if (text(payload.targetMode) !== "new") {
    throw analysisError("Análises Viewer v1 devem criar uma nova camada.");
  }
  for (const [key, label] of [
    ["targetLayerId", "targetLayerId"],
    ["targetDataId", "targetDataId"],
    ["targetLabel", "targetLabel"],
  ]) {
    const value = text(payload[key]);
    if (!value || value.length > 200) {
      throw analysisError(`${label} inválido.`);
    }
  }
  assertOrigin(payload.origin);
  assertFrozenAnalysisGeoJson(payload.geometry);
}

export function assertBufferCreatePayload(payload) {
  assertCommonPayload(payload);
  const radius = finiteNumber(payload.radiusMeters, "Raio do Buffer");
  if (radius <= 0 || radius > MAX_BUFFER_RADIUS_METERS) {
    throw analysisError("Raio do Buffer fora do intervalo permitido.");
  }
  if (payload.parameters != null && !isRecord(payload.parameters)) {
    throw analysisError("Parâmetros do Buffer inválidos.");
  }
}

export function assertIsochroneCreatePayload(payload) {
  assertCommonPayload(payload);
  if (!ISOCHRONE_MODES.has(text(payload.travelMode))) {
    throw analysisError("Modo de deslocamento da isócrona inválido.");
  }
  if (text(payload.provider).toLowerCase() !== "mapbox") {
    throw analysisError("Provider de isócrona não suportado nesta versão.");
  }
  if (!Array.isArray(payload.minutes) || payload.minutes.length < 1 || payload.minutes.length > MAX_ISOCHRONE_RANGES) {
    throw analysisError("Faixas de tempo da isócrona inválidas.");
  }
  const seen = new Set();
  for (const value of payload.minutes) {
    const minutes = finiteNumber(value, "Tempo da isócrona");
    if (minutes <= 0 || minutes > MAX_ISOCHRONE_MINUTES || seen.has(minutes)) {
      throw analysisError("Faixa de tempo da isócrona fora do intervalo permitido.");
    }
    seen.add(minutes);
  }
  if (payload.requestParameters != null && !isRecord(payload.requestParameters)) {
    throw analysisError("Parâmetros da isócrona inválidos.");
  }
}

export function isFrozenAnalysisOperation(operation) {
  return ANALYSIS_TYPES.has(text(operation?.type));
}

export function validateFrozenAnalysisOperation(operation) {
  const type = text(operation?.type);
  if (!ANALYSIS_TYPES.has(type) || Number(operation?.version) !== 1) {
    throw analysisError("Operação de análise não suportada.", "CHANGE_REQUEST_OPERATION_UNSUPPORTED");
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
  const geojson = payload.geometry;
  const features = geojson.features;
  const propertyKeys = [];
  const keySet = new Set();
  const samples = new Map();
  for (const feature of features) {
    for (const [key, value] of Object.entries(isRecord(feature.properties) ? feature.properties : {})) {
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
  const rows = features.map((feature) => [
    cloneJson(feature.geometry),
    ...propertyKeys.map((key) => cellValue(feature.properties?.[key])),
  ]);
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
        opacity: 0.28,
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

function projection(operation, payload) {
  const type = text(operation.type);
  const origin = payload.origin;
  const properties = type === "buffer.create"
    ? {
        radiusMeters: Number(payload.radiusMeters),
        origin: cloneJson(origin),
        parameters: cloneJson(payload.parameters || {}),
      }
    : {
        travelMode: text(payload.travelMode),
        minutes: cloneJson(payload.minutes),
        provider: text(payload.provider),
        origin: cloneJson(origin),
        requestParameters: cloneJson(payload.requestParameters || {}),
      };
  return {
    id: text(operation.id),
    sequence: Number(operation.sequence ?? 0),
    type,
    version: 1,
    label: text(payload.targetLabel),
    focus: {
      latitude: Number(origin.latitude),
      longitude: Number(origin.longitude),
    },
    target: {
      layerId: text(payload.targetLayerId),
      dataId: text(payload.targetDataId),
      label: text(payload.targetLabel),
    },
    overlay: {
      kind: "geojson",
      geojson: cloneJson(payload.geometry),
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
