const FILTER_TYPES = new Set(["range", "timeRange", "multiSelect", "select"]);
const MAX_LAYER_ORDER = 500;
const MAX_FILTER_VALUES = 5000;

function failure(message, code = "CHANGE_REQUEST_OPERATION_INVALID", details = null, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value, maximum = 300) {
  const normalized = String(value ?? "").trim();
  return normalized && normalized.length <= maximum ? normalized : "";
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function primitive(value) {
  return value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
}

function stringList(value, maximum = MAX_LAYER_ORDER) {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const result = value.map((item) => text(item, 200));
  if (result.some((item) => !item)) return null;
  return result;
}

function assertFilterValue(type, value) {
  if (type === "range" || type === "timeRange") {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry)) ||
      value[0] > value[1]
    ) {
      throw failure("Intervalo persistente inválido.");
    }
    return;
  }
  if (type === "select") {
    if (typeof value !== "boolean") throw failure("Filtro booleano persistente inválido.");
    return;
  }
  if (
    type !== "multiSelect" ||
    !Array.isArray(value) ||
    value.length > MAX_FILTER_VALUES ||
    !value.every(primitive)
  ) {
    throw failure("Seleção persistente inválida.");
  }
}

function normalizeFilterSnapshot(value, expectedId = null) {
  const source = record(value);
  if (!source) throw failure("Snapshot de filtro inválido.");
  const id = text(source.id, 200);
  const dataIds = stringList(source.dataIds, 20);
  const fieldNames = stringList(source.fieldNames, 20);
  const type = text(source.type, 40);
  if (
    !id ||
    (expectedId && id !== expectedId) ||
    !dataIds?.length ||
    !fieldNames?.length ||
    dataIds.length !== fieldNames.length ||
    !FILTER_TYPES.has(type) ||
    typeof source.enabled !== "boolean"
  ) {
    throw failure("Snapshot de filtro persistente inválido.");
  }
  assertFilterValue(type, source.value);
  return {
    id,
    dataIds,
    fieldNames,
    type,
    value: clone(source.value),
    enabled: source.enabled,
  };
}

function normalizeVisibilityPayload(payload) {
  const source = record(payload);
  const targetLayerId = text(source?.targetLayerId, 200);
  const targetDataId = source?.targetDataId == null ? null : text(source.targetDataId, 200);
  const targetLabel = text(source?.targetLabel, 300);
  if (
    !source ||
    !targetLayerId ||
    (source.targetDataId != null && !targetDataId) ||
    !targetLabel ||
    typeof source.before !== "boolean" ||
    typeof source.after !== "boolean" ||
    source.before === source.after
  ) {
    throw failure("Payload de layer.visibility.update inválido.");
  }
  return { targetLayerId, targetDataId, targetLabel, before: source.before, after: source.after };
}

function normalizeFilterPayload(payload) {
  const source = record(payload);
  const filterId = text(source?.filterId, 200);
  if (!source || !filterId || (source.before == null && source.after == null)) {
    throw failure("Payload de persistent.filter.update inválido.");
  }
  const before = source.before == null ? null : normalizeFilterSnapshot(source.before, filterId);
  const after = source.after == null ? null : normalizeFilterSnapshot(source.after, filterId);
  if (equal(before, after)) throw failure("persistent.filter.update não altera o filtro.");
  return { filterId, before, after };
}

function normalizeOrderPayload(payload) {
  const source = record(payload);
  const before = stringList(source?.before);
  const after = stringList(source?.after);
  if (
    !source ||
    !before ||
    !after ||
    before.length !== after.length ||
    new Set(before).size !== before.length ||
    new Set(after).size !== after.length ||
    before.some((id) => !after.includes(id)) ||
    equal(before, after)
  ) {
    throw failure("Payload de layer.order.update inválido.");
  }
  return { before, after };
}

export function isPersistentVisualizationOperation(operation) {
  const type = String(operation?.type || "").trim();
  return type === "layer.visibility.update" ||
    type === "persistent.filter.update" ||
    type === "layer.order.update";
}

export function validatePersistentVisualizationOperation(operation) {
  const type = String(operation?.type || "").trim();
  if (!isPersistentVisualizationOperation(operation) || Number(operation?.version) !== 1) {
    throw failure("Tipo ou versão de visualização persistente não suportado.", "CHANGE_REQUEST_OPERATION_VERSION_UNSUPPORTED");
  }
  if (type === "layer.visibility.update") return normalizeVisibilityPayload(operation.payload);
  if (type === "persistent.filter.update") return normalizeFilterPayload(operation.payload);
  return normalizeOrderPayload(operation.payload);
}

function ensureVisState(config) {
  if (!record(config.config)) config.config = {};
  if (!record(config.config.visState)) config.config.visState = {};
  if (!Array.isArray(config.config.visState.layers)) config.config.visState.layers = [];
  if (!Array.isArray(config.config.visState.filters)) config.config.visState.filters = [];
  return config.config.visState;
}

function layerId(layer) {
  return text(layer?.id, 200);
}

function layerDataIds(layer) {
  const raw = layer?.config?.dataId ?? layer?.dataId;
  return (Array.isArray(raw) ? raw : raw == null ? [] : [raw]).map((item) => text(item, 200)).filter(Boolean);
}

function findLayer(visState, id) {
  return visState.layers.find((layer) => layerId(layer) === id) || null;
}

function datasetId(dataset) {
  return text(dataset?.data?.id ?? dataset?.info?.id ?? dataset?.id, 200);
}

function datasetFields(dataset) {
  const raw = dataset?.data?.fields ?? dataset?.fields ?? [];
  return Array.isArray(raw) ? raw.map((field) => text(field?.name, 200)).filter(Boolean) : [];
}

function assertFilterTargets(config, snapshot) {
  const datasets = Array.isArray(config.datasets) ? config.datasets : [];
  for (let index = 0; index < snapshot.dataIds.length; index += 1) {
    const dataId = snapshot.dataIds[index];
    const fieldName = snapshot.fieldNames[index];
    const dataset = datasets.find((candidate) => datasetId(candidate) === dataId);
    if (!dataset) {
      throw failure(
        "O dataset do filtro não existe mais na revisão proposta.",
        "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
        { dataId },
        409,
      );
    }
    const fields = datasetFields(dataset);
    if (fields.length && !fields.includes(fieldName)) {
      throw failure(
        "O campo do filtro não existe mais no dataset da revisão proposta.",
        "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
        { dataId, fieldName },
        409,
      );
    }
  }
}

function rawFilterSnapshot(filter, logicalId) {
  const dataIds = (Array.isArray(filter?.dataId) ? filter.dataId : filter?.dataId == null ? [] : [filter.dataId])
    .map((item) => text(item, 200))
    .filter(Boolean);
  const fieldNames = (Array.isArray(filter?.name) ? filter.name : filter?.name == null ? [] : [filter.name])
    .map((item) => text(item, 200))
    .filter(Boolean);
  const type = text(filter?.type, 40);
  if (!logicalId || !dataIds.length || !fieldNames.length || !FILTER_TYPES.has(type)) return null;
  try {
    return normalizeFilterSnapshot({
      id: logicalId,
      dataIds,
      fieldNames,
      type,
      value: filter?.value,
      enabled: filter?.enabled !== false,
    }, logicalId);
  } catch {
    return null;
  }
}

function filterConfig(snapshot, current = null) {
  return {
    ...(record(current) ? clone(current) : {}),
    id: snapshot.id,
    dataId: [...snapshot.dataIds],
    name: [...snapshot.fieldNames],
    type: snapshot.type,
    value: clone(snapshot.value),
    enabled: snapshot.enabled,
  };
}

function projection(operation, label, target, properties) {
  return {
    id: text(operation.id, 200),
    sequence: Number(operation.sequence ?? 0),
    type: String(operation.type),
    version: 1,
    label,
    focus: null,
    target,
    overlay: null,
    properties,
  };
}

function applyVisibility(config, operation) {
  const payload = normalizeVisibilityPayload(operation.payload);
  const visState = ensureVisState(config);
  const layer = findLayer(visState, payload.targetLayerId);
  if (!layer) {
    throw failure(
      "A camada de visibilidade não existe mais na revisão proposta.",
      "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
      { layerId: payload.targetLayerId },
      409,
    );
  }
  if (payload.targetDataId && !layerDataIds(layer).includes(payload.targetDataId)) {
    throw failure(
      "A camada de visibilidade não referencia mais o dataset esperado.",
      "CHANGE_REQUEST_OPERATION_TARGET_INVALID",
      { layerId: payload.targetLayerId, dataId: payload.targetDataId },
      409,
    );
  }
  if (!record(layer.config)) layer.config = {};
  const current = layer.config.isVisible !== false;
  if (current !== payload.before) {
    throw failure(
      "A visibilidade da camada divergiu do estado-base da operação.",
      "CHANGE_REQUEST_OPERATION_TARGET_CONFLICT",
      { layerId: payload.targetLayerId, expected: payload.before, actual: current },
      409,
    );
  }
  layer.config.isVisible = payload.after;
  return projection(
    operation,
    payload.targetLabel,
    { layerId: payload.targetLayerId, dataId: payload.targetDataId, label: payload.targetLabel },
    {
      before: payload.before,
      after: payload.after,
      beforeLabel: payload.before ? "Visível" : "Oculta",
      afterLabel: payload.after ? "Visível" : "Oculta",
    },
  );
}

function applyFilter(config, operation) {
  const payload = normalizeFilterPayload(operation.payload);
  const visState = ensureVisState(config);
  const index = visState.filters.findIndex((candidate) => text(candidate?.id, 200) === payload.filterId);
  const current = index >= 0 ? visState.filters[index] : null;

  if (payload.before) {
    if (!current) {
      throw failure(
        "O filtro de destino não existe mais na revisão proposta.",
        "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
        { filterId: payload.filterId },
        409,
      );
    }
    const currentSnapshot = rawFilterSnapshot(current, payload.filterId);
    if (!currentSnapshot || !equal(currentSnapshot, payload.before)) {
      throw failure(
        "O filtro divergiu do estado-base da operação.",
        "CHANGE_REQUEST_OPERATION_TARGET_CONFLICT",
        { filterId: payload.filterId },
        409,
      );
    }
  } else if (current) {
    throw failure(
      "Já existe um filtro com o identificador proposto.",
      "CHANGE_REQUEST_OPERATION_TARGET_CONFLICT",
      { filterId: payload.filterId },
      409,
    );
  }

  if (payload.after) {
    assertFilterTargets(config, payload.after);
    const next = filterConfig(payload.after, current);
    if (index >= 0) visState.filters[index] = next;
    else visState.filters.push(next);
  } else if (index >= 0) {
    visState.filters.splice(index, 1);
  }

  const beforeLabel = payload.before
    ? `${payload.before.fieldNames.join(", ")}: ${Array.isArray(payload.before.value) ? payload.before.value.join(" – ") : String(payload.before.value)}`
    : "Sem filtro";
  const afterLabel = payload.after
    ? `${payload.after.fieldNames.join(", ")}: ${Array.isArray(payload.after.value) ? payload.after.value.join(" – ") : String(payload.after.value)}`
    : "Sem filtro";
  const targetSnapshot = payload.after || payload.before;
  return projection(
    operation,
    targetSnapshot?.fieldNames.join(", ") || "Filtro persistente",
    {
      layerId: null,
      dataId: targetSnapshot?.dataIds[0] || null,
      label: targetSnapshot?.fieldNames.join(", ") || "Filtro persistente",
    },
    { before: payload.before, after: payload.after, beforeLabel, afterLabel },
  );
}

function currentLayerOrder(visState) {
  const ids = visState.layers.map(layerId).filter(Boolean);
  const explicit = Array.isArray(visState.layerOrder)
    ? visState.layerOrder.map((id) => text(id, 200)).filter(Boolean)
    : [];
  if (
    explicit.length === ids.length &&
    new Set(explicit).size === ids.length &&
    explicit.every((id) => ids.includes(id))
  ) {
    return explicit;
  }
  return ids;
}

function applyOrder(config, operation) {
  const payload = normalizeOrderPayload(operation.payload);
  const visState = ensureVisState(config);
  const current = currentLayerOrder(visState);
  if (!equal(current, payload.before)) {
    throw failure(
      "A ordem das camadas divergiu do estado-base da operação.",
      "CHANGE_REQUEST_OPERATION_TARGET_CONFLICT",
      { expected: payload.before, actual: current },
      409,
    );
  }
  const ids = visState.layers.map(layerId).filter(Boolean);
  if (
    payload.after.length !== ids.length ||
    payload.after.some((id) => !ids.includes(id))
  ) {
    throw failure(
      "A ordem proposta referencia uma camada inexistente.",
      "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
      { after: payload.after, available: ids },
      409,
    );
  }
  const byId = new Map(visState.layers.map((layer) => [layerId(layer), layer]));
  visState.layers = payload.after.map((id) => byId.get(id));
  visState.layerOrder = [...payload.after];
  return projection(
    operation,
    "Ordem das camadas",
    { layerId: null, dataId: null, label: "Ordem das camadas" },
    {
      before: payload.before,
      after: payload.after,
      beforeLabel: payload.before.join(" → "),
      afterLabel: payload.after.join(" → "),
    },
  );
}

export function applyPersistentVisualizationOperation(config, operation) {
  validatePersistentVisualizationOperation(operation);
  if (operation.type === "layer.visibility.update") return applyVisibility(config, operation);
  if (operation.type === "persistent.filter.update") return applyFilter(config, operation);
  return applyOrder(config, operation);
}
