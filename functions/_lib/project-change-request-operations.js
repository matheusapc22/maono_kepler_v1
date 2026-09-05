const POINT_LAYER_TYPES = new Set(["point", "cluster", "heatmap"]);

function operationError(message, code, details = null, status = 409) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  if (details) error.details = details;
  return error;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizedFieldName(value) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function finiteCoordinate(value, minimum, maximum, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw operationError(
      `Coordenada ${field} inválida em point.create.`,
      "CHANGE_REQUEST_OPERATION_INVALID",
      { field },
      400,
    );
  }
  return number;
}

function datasetId(dataset) {
  if (!isRecord(dataset)) return "";
  return text(dataset?.data?.id ?? dataset?.info?.id ?? dataset?.id);
}

function layerDataIds(layer) {
  const value = layer?.config?.dataId ?? layer?.dataId;
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const normalized = text(value);
  return normalized ? [normalized] : [];
}

function findDataset(config, dataId) {
  return (Array.isArray(config?.datasets) ? config.datasets : []).find(
    (dataset) => datasetId(dataset) === dataId,
  ) || null;
}

function layers(config) {
  if (!isRecord(config.config)) config.config = {};
  if (!isRecord(config.config.visState)) config.config.visState = {};
  if (!Array.isArray(config.config.visState.layers)) {
    config.config.visState.layers = [];
  }
  return config.config.visState.layers;
}

function findLayer(config, layerId) {
  return layers(config).find((layer) => text(layer?.id) === layerId) || null;
}

function ensureDatasetCollections(config) {
  if (!Array.isArray(config.datasets)) config.datasets = [];
  return config.datasets;
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
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function datasetTable(dataset) {
  if (!isRecord(dataset?.data)) {
    throw operationError(
      "O dataset de destino não possui dados compatíveis com point.create.",
      "CHANGE_REQUEST_OPERATION_TARGET_INVALID",
    );
  }
  if (!Array.isArray(dataset.data.fields)) {
    throw operationError(
      "O dataset de destino não possui fields compatível com point.create.",
      "CHANGE_REQUEST_OPERATION_TARGET_INVALID",
    );
  }
  if (!Array.isArray(dataset.data.allData)) {
    if (Array.isArray(dataset.data.rows)) {
      dataset.data.allData = dataset.data.rows.map((row) =>
        Array.isArray(row) ? [...row] : [],
      );
      delete dataset.data.rows;
    } else {
      throw operationError(
        "O dataset de destino não possui allData compatível com point.create.",
        "CHANGE_REQUEST_OPERATION_TARGET_INVALID",
      );
    }
  }
  return { fields: dataset.data.fields, rows: dataset.data.allData };
}

function findField(fields, preferred) {
  const exact = fields.find((field) => text(field?.name) === preferred);
  if (exact) return text(exact.name);
  const normalized = normalizedFieldName(preferred);
  const loose = fields.find(
    (field) => normalizedFieldName(field?.name) === normalized,
  );
  return loose ? text(loose.name) : null;
}

function appendField(table, name, sample) {
  const existing = findField(table.fields, name);
  if (existing) return existing;
  table.fields.push(inferField(sample, name));
  for (const row of table.rows) {
    if (Array.isArray(row)) row.push(null);
  }
  return name;
}

function fieldIndex(table, name) {
  return table.fields.findIndex((field) => text(field?.name) === name);
}

function pointProperties(payload) {
  return isRecord(payload.properties) ? payload.properties : {};
}

function propertyFieldName(table, fieldMap, key, value) {
  const mapped = text(fieldMap?.[key]);
  if (mapped) return appendField(table, mapped, value);
  const existing = findField(table.fields, key);
  if (existing) return existing;
  return appendField(table, key, value);
}

function appendPointToDataset(dataset, payload) {
  const table = datasetTable(dataset);
  const fieldMap = isRecord(payload.fieldMap) ? payload.fieldMap : {};
  const latitudeField = text(fieldMap.latitude);
  const longitudeField = text(fieldMap.longitude);
  if (!latitudeField || !longitudeField) {
    throw operationError(
      "point.create não informou o mapeamento de latitude/longitude.",
      "CHANGE_REQUEST_OPERATION_TARGET_INVALID",
    );
  }
  const resolvedLatitude = findField(table.fields, latitudeField);
  const resolvedLongitude = findField(table.fields, longitudeField);
  if (!resolvedLatitude || !resolvedLongitude) {
    throw operationError(
      "A camada de destino não possui os campos geográficos esperados.",
      "CHANGE_REQUEST_OPERATION_TARGET_INVALID",
      { latitudeField, longitudeField },
    );
  }

  const latitude = finiteCoordinate(payload.latitude, -90, 90, "latitude");
  const longitude = finiteCoordinate(payload.longitude, -180, 180, "longitude");
  const values = new Map([
    [resolvedLatitude, latitude],
    [resolvedLongitude, longitude],
  ]);

  const properties = pointProperties(payload);
  for (const [key, value] of Object.entries(properties)) {
    const name = propertyFieldName(table, fieldMap, key, value);
    values.set(name, cellValue(value));
  }

  const idField = text(fieldMap.id);
  const tempId = text(payload.tempId);
  if (idField && tempId) {
    const resolvedId = appendField(table, idField, tempId);
    const idIndex = fieldIndex(table, resolvedId);
    if (
      idIndex >= 0 &&
      table.rows.some((row) => Array.isArray(row) && text(row[idIndex]) === tempId)
    ) {
      return { changed: false, latitude, longitude, properties };
    }
    values.set(resolvedId, tempId);
  }

  const row = table.fields.map((field) => values.get(text(field?.name)) ?? null);
  table.rows.push(row);
  return { changed: true, latitude, longitude, properties };
}

function createPointDataset(payload) {
  const dataId = text(payload.targetDataId);
  const layerId = text(payload.targetLayerId);
  if (!dataId || !layerId) {
    throw operationError(
      "point.create em nova camada não possui targetDataId/targetLayerId.",
      "CHANGE_REQUEST_OPERATION_TARGET_INVALID",
    );
  }

  const fieldMap = isRecord(payload.fieldMap) ? payload.fieldMap : {};
  const latitudeField = text(fieldMap.latitude) || "latitude";
  const longitudeField = text(fieldMap.longitude) || "longitude";
  const properties = pointProperties(payload);
  const fields = [
    inferField(Number(payload.latitude), latitudeField),
    inferField(Number(payload.longitude), longitudeField),
  ];
  const used = new Set(fields.map((field) => field.name));
  const propertyFields = new Map();
  for (const [key, value] of Object.entries(properties)) {
    const preferred = text(fieldMap[key]) || key;
    const name = used.has(preferred) ? `${preferred}_${key}` : preferred;
    if (!used.has(name)) {
      fields.push(inferField(value, name));
      used.add(name);
    }
    propertyFields.set(key, name);
  }
  const idField = text(fieldMap.id) || "maono_point_id";
  if (!used.has(idField)) {
    fields.push(inferField(text(payload.tempId), idField));
    used.add(idField);
  }

  const values = new Map([
    [latitudeField, finiteCoordinate(payload.latitude, -90, 90, "latitude")],
    [longitudeField, finiteCoordinate(payload.longitude, -180, 180, "longitude")],
    [idField, text(payload.tempId) || null],
  ]);
  for (const [key, value] of Object.entries(properties)) {
    values.set(propertyFields.get(key), cellValue(value));
  }
  const row = fields.map((field) => values.get(field.name) ?? null);
  const label = text(payload.targetLabel) || "Pontos adicionados";

  return {
    dataset: {
      version: "v1",
      data: {
        id: dataId,
        label,
        color: [197, 160, 89],
        allData: [row],
        fields,
      },
    },
    layer: {
      id: layerId,
      type: "point",
      config: {
        dataId,
        label,
        color: [197, 160, 89],
        columns: { lat: latitudeField, lng: longitudeField, altitude: null },
        isVisible: true,
        visConfig: { radius: 10, opacity: 0.8, outline: false },
      },
      visualChannels: {
        colorField: null,
        colorScale: "quantile",
        sizeField: null,
        sizeScale: "linear",
      },
    },
  };
}

function assertExistingTarget(config, payload, dataId) {
  const layerId = text(payload.targetLayerId);
  if (!layerId) {
    throw operationError(
      "point.create não informou a camada de destino.",
      "CHANGE_REQUEST_OPERATION_TARGET_INVALID",
    );
  }
  const layer = findLayer(config, layerId);
  if (!layer) {
    throw operationError(
      "A camada de destino da proposta não existe mais na revisão-base.",
      "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
      { layerId, dataId },
    );
  }
  const type = text(layer.type).toLowerCase();
  if (type && !POINT_LAYER_TYPES.has(type)) {
    throw operationError(
      "A camada de destino não é compatível com point.create.",
      "CHANGE_REQUEST_OPERATION_TARGET_INVALID",
      { layerId, type },
    );
  }
  if (!layerDataIds(layer).includes(dataId)) {
    throw operationError(
      "A camada de destino não referencia o dataset esperado.",
      "CHANGE_REQUEST_OPERATION_TARGET_INVALID",
      { layerId, dataId },
    );
  }
  return layer;
}

function pointCreateProjection(operation, payload) {
  const properties = cloneJson(pointProperties(payload));
  const label = text(properties.name) || text(payload.targetLabel) || "Novo ponto";
  return {
    id: text(operation.id),
    sequence: Number(operation.sequence ?? 0),
    type: "point.create",
    version: 1,
    label,
    focus: {
      latitude: Number(payload.latitude),
      longitude: Number(payload.longitude),
    },
    target: {
      layerId: text(payload.targetLayerId) || null,
      dataId: text(payload.targetDataId) || null,
      label: text(payload.targetLabel) || "Camada de pontos",
    },
    overlay: {
      kind: "point",
      latitude: Number(payload.latitude),
      longitude: Number(payload.longitude),
    },
    properties,
  };
}

function applyPointCreate(config, operation) {
  const payload = isRecord(operation.payload) ? operation.payload : null;
  if (!payload) {
    throw operationError(
      "Payload de point.create inválido.",
      "CHANGE_REQUEST_OPERATION_INVALID",
      { operationId: operation.id },
      400,
    );
  }
  const dataId = text(payload.targetDataId);
  if (!dataId) {
    throw operationError(
      "point.create não informou o dataset de destino.",
      "CHANGE_REQUEST_OPERATION_TARGET_INVALID",
      { operationId: operation.id },
    );
  }

  let dataset = findDataset(config, dataId);
  const createNew = text(payload.targetMode).toLowerCase() === "new";
  if (!dataset && createNew) {
    const created = createPointDataset(payload);
    ensureDatasetCollections(config).push(created.dataset);
    layers(config).push(created.layer);
    dataset = created.dataset;
  } else {
    if (!dataset) {
      throw operationError(
        "O dataset de destino da proposta não existe mais na revisão-base.",
        "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
        { operationId: operation.id, dataId },
      );
    }
    assertExistingTarget(config, payload, dataId);
    appendPointToDataset(dataset, payload);
  }

  return pointCreateProjection(operation, payload);
}

export const PROJECT_CHANGE_OPERATION_APPLIERS = Object.freeze({
  "point.create": Object.freeze({
    version: 1,
    apply: applyPointCreate,
  }),
});

export function buildProjectChangeProposal({ baseConfig, operations }) {
  if (!isRecord(baseConfig)) {
    throw operationError(
      "A revisão-base não contém uma configuração válida.",
      "CHANGE_REQUEST_BASE_CONFIG_INVALID",
      null,
      409,
    );
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    throw operationError(
      "A solicitação não possui operações para aplicar.",
      "CHANGE_REQUEST_OPERATION_COUNT_INVALID",
      null,
      400,
    );
  }

  const config = cloneJson(baseConfig);
  const projections = [];
  for (const operation of operations) {
    const type = text(operation?.type);
    const entry = PROJECT_CHANGE_OPERATION_APPLIERS[type];
    if (!entry) {
      throw operationError(
        "Tipo de operação não suportado pelo Review.",
        "CHANGE_REQUEST_OPERATION_UNSUPPORTED",
        { type },
        400,
      );
    }
    if (Number(operation?.version) !== entry.version) {
      throw operationError(
        "Versão de operação não suportada pelo Review.",
        "CHANGE_REQUEST_OPERATION_VERSION_UNSUPPORTED",
        { type, version: operation?.version },
        400,
      );
    }
    try {
      projections.push(entry.apply(config, operation));
    } catch (error) {
      if (!error.details) error.details = {};
      error.details.operationId = text(operation?.id) || null;
      error.details.sequence = Number(operation?.sequence ?? 0);
      throw error;
    }
  }

  return {
    config,
    projections,
    operationCount: operations.length,
  };
}

export function isProjectChangeOperationConflict(error) {
  return String(error?.code || "").startsWith("CHANGE_REQUEST_OPERATION_TARGET_") ||
    error?.code === "CHANGE_REQUEST_BASE_CONFIG_INVALID";
}
