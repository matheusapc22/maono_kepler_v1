const SUPPORTED_LAYER_TYPES = new Set(["point", "cluster", "heatmap", "geojson"]);
const MAX_LAYERS = 500;
const COLUMN_KEYS = ["latitude", "longitude", "geojson", "altitude"];
const STYLE_KEYS = [
  "fillEnabled",
  "opacity",
  "color",
  "colorField",
  "colorScale",
  "colorPalette",
  "colorPaletteId",
  "strokeEnabled",
  "strokeColor",
  "strokeColorField",
  "strokeColorScale",
  "strokeColorPalette",
  "strokeColorPaletteId",
  "strokeOpacity",
  "strokeWidth",
  "pointRadius",
  "radiusField",
  "radiusScale",
  "radiusRange",
  "clusterRadius",
  "heatmapRadius",
];
const CHANNEL_KEYS = ["color", "strokeColor", "size", "height"];
const COLOR_SCALES = new Set(["quantile", "quantize", "linear", "sqrt", "log", "ordinal"]);
const DEFAULT_COLOR = [47, 125, 244];

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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function text(value, maximum = 300) {
  const normalized = String(value ?? "").trim();
  return normalized && normalized.length <= maximum ? normalized : "";
}

function optionalText(value, maximum = 300) {
  if (value == null || value === "") return null;
  return text(value, maximum) || null;
}

function exactKeys(value, allowed) {
  const set = new Set(allowed);
  return Object.keys(value).every((key) => set.has(key));
}

function boundedNumber(value, minimum, maximum, nullable = false) {
  if (nullable && value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw failure("Snapshot estrutural contém número fora do intervalo permitido.");
  }
  return number;
}

function rgb(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((channel) => !Number.isFinite(Number(channel)) || Number(channel) < 0 || Number(channel) > 255)
  ) {
    throw failure("Snapshot estrutural contém cor RGB inválida.");
  }
  return value.map((channel) => Math.round(Number(channel)));
}

function palette(value) {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((color) => typeof color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(color))
  ) {
    throw failure("Snapshot estrutural contém paleta inválida.");
  }
  return value.map(String);
}

function stringList(value, maximum = 20) {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) {
    throw failure("Snapshot estrutural contém lista de datasets inválida.");
  }
  const result = value.map((item) => text(item, 200));
  if (result.some((item) => !item) || new Set(result).size !== result.length) {
    throw failure("Snapshot estrutural contém datasets inválidos ou duplicados.");
  }
  return result;
}

function normalizeChannel(value) {
  const source = record(value);
  if (!source || !exactKeys(source, ["field", "scale"])) {
    throw failure("Snapshot estrutural contém canal visual inválido.");
  }
  return {
    field: optionalText(source.field, 200),
    scale: optionalText(source.scale, 80),
  };
}

export function normalizeLayerLifecycleSnapshot(value) {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, [
      "id",
      "type",
      "dataIds",
      "label",
      "isVisible",
      "columns",
      "style",
      "visualChannels",
    ])
  ) {
    throw failure("Snapshot estrutural de camada inválido.");
  }
  const id = text(source.id, 200);
  const type = text(source.type, 40).toLowerCase();
  const label = text(source.label, 300);
  if (!id || !SUPPORTED_LAYER_TYPES.has(type) || !label || typeof source.isVisible !== "boolean") {
    throw failure("Snapshot estrutural de camada inválido.");
  }
  const dataIds = stringList(source.dataIds);

  const columnsSource = record(source.columns);
  if (!columnsSource || !exactKeys(columnsSource, COLUMN_KEYS)) {
    throw failure("Snapshot estrutural contém colunas inválidas.");
  }
  const columns = Object.fromEntries(
    COLUMN_KEYS.map((key) => [key, optionalText(columnsSource[key], 200)]),
  );

  const styleSource = record(source.style);
  if (!styleSource || !exactKeys(styleSource, STYLE_KEYS)) {
    throw failure("Snapshot estrutural contém estilo inválido.");
  }
  if (typeof styleSource.fillEnabled !== "boolean" || typeof styleSource.strokeEnabled !== "boolean") {
    throw failure("Snapshot estrutural contém flags de estilo inválidas.");
  }
  const radiusRange = styleSource.radiusRange == null
    ? null
    : (() => {
        if (!Array.isArray(styleSource.radiusRange) || styleSource.radiusRange.length !== 2) {
          throw failure("Snapshot estrutural contém intervalo de raio inválido.");
        }
        const result = styleSource.radiusRange.map((entry) => boundedNumber(entry, 0, 10000));
        if (result[0] > result[1]) throw failure("Snapshot estrutural contém intervalo de raio inválido.");
        return result;
      })();
  const style = {
    fillEnabled: styleSource.fillEnabled,
    opacity: boundedNumber(styleSource.opacity, 0, 1),
    color: rgb(styleSource.color),
    colorField: optionalText(styleSource.colorField, 200),
    colorScale: optionalText(styleSource.colorScale, 80),
    colorPalette: palette(styleSource.colorPalette),
    colorPaletteId: optionalText(styleSource.colorPaletteId, 120),
    strokeEnabled: styleSource.strokeEnabled,
    strokeColor: rgb(styleSource.strokeColor),
    strokeColorField: optionalText(styleSource.strokeColorField, 200),
    strokeColorScale: optionalText(styleSource.strokeColorScale, 80),
    strokeColorPalette: palette(styleSource.strokeColorPalette),
    strokeColorPaletteId: optionalText(styleSource.strokeColorPaletteId, 120),
    strokeOpacity: boundedNumber(styleSource.strokeOpacity, 0, 1),
    strokeWidth: boundedNumber(styleSource.strokeWidth, 0, 500),
    pointRadius: boundedNumber(styleSource.pointRadius, 0, 500, true),
    radiusField: optionalText(styleSource.radiusField, 200),
    radiusScale: optionalText(styleSource.radiusScale, 80),
    radiusRange,
    clusterRadius: boundedNumber(styleSource.clusterRadius, 0, 500, true),
    heatmapRadius: boundedNumber(styleSource.heatmapRadius, 0, 500, true),
  };

  const channelsSource = record(source.visualChannels);
  if (!channelsSource || !exactKeys(channelsSource, CHANNEL_KEYS)) {
    throw failure("Snapshot estrutural contém canais visuais inválidos.");
  }
  const visualChannels = Object.fromEntries(
    CHANNEL_KEYS.map((key) => [key, normalizeChannel(channelsSource[key])]),
  );

  return { id, type, dataIds, label, isVisible: source.isVisible, columns, style, visualChannels };
}

function validIndex(value) {
  const index = Number(value);
  if (!Number.isInteger(index) || index < 0 || index > MAX_LAYERS) {
    throw failure("Posição estrutural da camada inválida.");
  }
  return index;
}

function normalizeCreate(payload) {
  const source = record(payload);
  if (!source || !exactKeys(source, ["layer", "insertIndex"])) {
    throw failure("Payload de layer.create inválido.");
  }
  return { layer: normalizeLayerLifecycleSnapshot(source.layer), insertIndex: validIndex(source.insertIndex) };
}

function normalizeDuplicate(payload) {
  const source = record(payload);
  if (!source || !exactKeys(source, ["sourceLayerId", "source", "layer", "insertIndex"])) {
    throw failure("Payload de layer.duplicate inválido.");
  }
  const sourceLayerId = text(source.sourceLayerId, 200);
  const before = normalizeLayerLifecycleSnapshot(source.source);
  const layer = normalizeLayerLifecycleSnapshot(source.layer);
  if (
    !sourceLayerId ||
    before.id !== sourceLayerId ||
    before.id === layer.id ||
    before.type !== layer.type ||
    !equal(before.dataIds, layer.dataIds)
  ) {
    throw failure("Payload de layer.duplicate inválido.");
  }
  return { sourceLayerId, source: before, layer, insertIndex: validIndex(source.insertIndex) };
}

function normalizeRemove(payload) {
  const source = record(payload);
  if (!source || !exactKeys(source, ["targetLayerId", "before", "previousIndex"])) {
    throw failure("Payload de layer.remove inválido.");
  }
  const targetLayerId = text(source.targetLayerId, 200);
  const before = normalizeLayerLifecycleSnapshot(source.before);
  if (!targetLayerId || before.id !== targetLayerId) {
    throw failure("Payload de layer.remove inválido.");
  }
  return { targetLayerId, before, previousIndex: validIndex(source.previousIndex) };
}

export function isLayerLifecycleOperation(operation) {
  const type = String(operation?.type || "").trim();
  return type === "layer.create" || type === "layer.duplicate" || type === "layer.remove";
}

export function validateLayerLifecycleOperation(operation) {
  if (!isLayerLifecycleOperation(operation) || Number(operation?.version) !== 1) {
    throw failure(
      "Tipo ou versão de lifecycle de camada não suportado.",
      "CHANGE_REQUEST_OPERATION_VERSION_UNSUPPORTED",
    );
  }
  if (operation.type === "layer.create") return normalizeCreate(operation.payload);
  if (operation.type === "layer.duplicate") return normalizeDuplicate(operation.payload);
  return normalizeRemove(operation.payload);
}

function ensureVisState(config) {
  if (!record(config.config)) config.config = {};
  if (!record(config.config.visState)) config.config.visState = {};
  if (!Array.isArray(config.config.visState.layers)) config.config.visState.layers = [];
  return config.config.visState;
}

function datasetId(dataset) {
  return text(dataset?.data?.id ?? dataset?.info?.id ?? dataset?.id, 200);
}

function assertDatasets(config, snapshot) {
  const datasets = Array.isArray(config.datasets) ? config.datasets : [];
  for (const dataId of snapshot.dataIds) {
    if (!datasets.some((dataset) => datasetId(dataset) === dataId)) {
      throw failure(
        "O dataset da camada não existe mais na revisão proposta.",
        "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
        { dataId, layerId: snapshot.id },
        409,
      );
    }
  }
}

function rawLayerId(layer) {
  return text(layer?.id, 200);
}

function rawDataIds(layer) {
  const raw = layer?.config?.dataId ?? layer?.dataId;
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return Array.from(new Set(list.map((item) => text(item, 200)).filter(Boolean)));
}

function finite(value, fallback, minimum = -Infinity, maximum = Infinity) {
  const number = Number(value);
  const result = Number.isFinite(number) ? number : fallback;
  return Math.min(maximum, Math.max(minimum, result));
}

function rawColor(value, fallback = DEFAULT_COLOR) {
  return Array.isArray(value) && value.length >= 3
    ? value.slice(0, 3).map((channel, index) => Math.round(finite(channel, fallback[index], 0, 255)))
    : [...fallback];
}

function rawColumn(value) {
  if (typeof value === "string") return value.trim() || null;
  return optionalText(value?.value ?? value?.name, 200);
}

function rawField(value) {
  if (typeof value === "string") return value.trim() || null;
  return optionalText(value?.name ?? value?.value, 200);
}

function rawScale(value) {
  return COLOR_SCALES.has(value) ? value : null;
}

function rawPalette(value) {
  const colors = value?.colors ?? value;
  return Array.isArray(colors)
    ? colors.map(String).filter((color) => /^#[0-9A-Fa-f]{6}$/.test(color))
    : [];
}

function rawPaletteId(value) {
  const name = text(value?.name, 160);
  return name.startsWith("maono:") ? name.slice("maono:".length) || null : null;
}

function canonicalRawLayer(layer) {
  const config = record(layer?.config) || {};
  const vis = record(config.visConfig) || {};
  const columns = record(config.columns) || {};
  const type = text(layer?.type, 40).toLowerCase();
  const dataIds = rawDataIds(layer);
  const snapshot = {
    id: rawLayerId(layer),
    type,
    dataIds,
    label: text(config.label || rawLayerId(layer), 300),
    isVisible: config.isVisible !== false,
    columns: {
      latitude: rawColumn(columns.lat ?? columns.latitude),
      longitude: rawColumn(columns.lng ?? columns.longitude),
      geojson: rawColumn(columns.geojson ?? columns.geometry),
      altitude: rawColumn(columns.altitude ?? columns.height),
    },
    style: {
      fillEnabled: vis.filled !== false,
      opacity: finite(vis.opacity, 0.8, 0, 1),
      color: rawColor(config.color),
      colorField: rawField(config.colorField ?? layer?.colorField),
      colorScale: rawScale(config.colorScale ?? vis.colorScale),
      colorPalette: rawPalette(vis.colorRange),
      colorPaletteId: rawPaletteId(vis.colorRange),
      strokeEnabled: vis.stroked === true || vis.outline === true,
      strokeColor: rawColor(vis.strokeColor),
      strokeColorField: rawField(config.strokeColorField ?? layer?.strokeColorField),
      strokeColorScale: rawScale(config.strokeColorScale ?? vis.strokeColorScale),
      strokeColorPalette: rawPalette(vis.strokeColorRange),
      strokeColorPaletteId: rawPaletteId(vis.strokeColorRange),
      strokeOpacity: finite(vis.strokeOpacity, 1, 0, 1),
      strokeWidth: finite(vis.thickness ?? vis.strokeWidth, 1, 0, 500),
      pointRadius: vis.radius == null ? null : finite(vis.radius, 10, 0, 500),
      radiusField: rawField(config.sizeField ?? config.radiusField ?? layer?.sizeField ?? layer?.radiusField),
      radiusScale: config.sizeScale == null && config.radiusScale == null
        ? null
        : text(config.sizeScale ?? config.radiusScale, 80) || null,
      radiusRange: Array.isArray(vis.radiusRange) && vis.radiusRange.length === 2
        ? [finite(vis.radiusRange[0], 0, 0, 10000), finite(vis.radiusRange[1], 50, 0, 10000)]
        : null,
      clusterRadius: vis.clusterRadius == null ? null : finite(vis.clusterRadius, 40, 0, 500),
      heatmapRadius: type !== "heatmap"
        ? null
        : vis.heatmapRadius == null
          ? vis.radius == null ? null : finite(vis.radius, 20, 0, 500)
          : finite(vis.heatmapRadius, 20, 0, 500),
    },
    visualChannels: {
      color: { field: rawField(config.colorField ?? layer?.colorField), scale: rawScale(config.colorScale ?? vis.colorScale) },
      strokeColor: { field: rawField(config.strokeColorField ?? layer?.strokeColorField), scale: rawScale(config.strokeColorScale ?? vis.strokeColorScale) },
      size: { field: rawField(config.sizeField ?? layer?.sizeField), scale: rawScale(config.sizeScale ?? vis.sizeScale) },
      height: { field: rawField(config.heightField ?? layer?.heightField), scale: rawScale(config.heightScale ?? vis.heightScale) },
    },
  };
  return normalizeLayerLifecycleSnapshot(snapshot);
}

function colorRange(colors, id) {
  if (!colors.length) return undefined;
  return {
    name: `maono:${id || "custom"}`,
    type: "sequential",
    category: "Custom",
    colors: [...colors],
  };
}

function snapshotToLayer(snapshot) {
  const visConfig = {
    opacity: snapshot.style.opacity,
    filled: snapshot.style.fillEnabled,
    strokeColor: [...snapshot.style.strokeColor],
    strokeOpacity: snapshot.style.strokeOpacity,
    thickness: snapshot.style.strokeWidth,
  };
  if (snapshot.type === "point") visConfig.outline = snapshot.style.strokeEnabled;
  else visConfig.stroked = snapshot.style.strokeEnabled;
  if (snapshot.style.pointRadius != null) visConfig.radius = snapshot.style.pointRadius;
  if (snapshot.style.clusterRadius != null) visConfig.clusterRadius = snapshot.style.clusterRadius;
  if (snapshot.style.heatmapRadius != null) visConfig.heatmapRadius = snapshot.style.heatmapRadius;
  if (snapshot.style.radiusRange) visConfig.radiusRange = [...snapshot.style.radiusRange];
  const fillRange = colorRange(snapshot.style.colorPalette, snapshot.style.colorPaletteId);
  const strokeRange = colorRange(snapshot.style.strokeColorPalette, snapshot.style.strokeColorPaletteId);
  if (fillRange) visConfig.colorRange = fillRange;
  if (strokeRange) visConfig.strokeColorRange = strokeRange;

  const columns = snapshot.type === "geojson"
    ? { geojson: snapshot.columns.geojson }
    : {
        lat: snapshot.columns.latitude,
        lng: snapshot.columns.longitude,
        altitude: snapshot.columns.altitude,
      };
  const dataId = snapshot.dataIds.length === 1 ? snapshot.dataIds[0] : [...snapshot.dataIds];
  return {
    id: snapshot.id,
    type: snapshot.type,
    config: {
      dataId,
      label: snapshot.label,
      isVisible: snapshot.isVisible,
      color: [...snapshot.style.color],
      columns,
      visConfig,
      colorField: snapshot.visualChannels.color.field,
      colorScale: snapshot.visualChannels.color.scale,
      strokeColorField: snapshot.visualChannels.strokeColor.field,
      strokeColorScale: snapshot.visualChannels.strokeColor.scale,
      sizeField: snapshot.visualChannels.size.field,
      sizeScale: snapshot.visualChannels.size.scale,
      heightField: snapshot.visualChannels.height.field,
      heightScale: snapshot.visualChannels.height.scale,
    },
  };
}

function currentOrder(visState) {
  const ids = visState.layers.map(rawLayerId).filter(Boolean);
  const explicit = Array.isArray(visState.layerOrder)
    ? visState.layerOrder.map((id) => text(id, 200)).filter(Boolean)
    : [];
  return explicit.length === ids.length && new Set(explicit).size === ids.length && explicit.every((id) => ids.includes(id))
    ? explicit
    : ids;
}

function insertLayer(visState, snapshot, insertIndex) {
  if (visState.layers.length >= MAX_LAYERS) {
    throw failure("O projeto atingiu o limite estrutural de camadas.", "CHANGE_REQUEST_OPERATION_TARGET_INVALID", null, 409);
  }
  const index = Math.max(0, Math.min(insertIndex, visState.layers.length));
  visState.layers.splice(index, 0, snapshotToLayer(snapshot));
  const order = currentOrder(visState).filter((id) => id !== snapshot.id);
  order.splice(index, 0, snapshot.id);
  const byId = new Map(visState.layers.map((layer) => [rawLayerId(layer), layer]));
  visState.layers = order.map((id) => byId.get(id)).filter(Boolean);
  visState.layerOrder = [...order];
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

function applyCreate(config, operation) {
  const payload = normalizeCreate(operation.payload);
  const visState = ensureVisState(config);
  if (visState.layers.some((layer) => rawLayerId(layer) === payload.layer.id)) {
    throw failure(
      "Já existe uma camada com o identificador proposto.",
      "CHANGE_REQUEST_OPERATION_TARGET_CONFLICT",
      { layerId: payload.layer.id },
      409,
    );
  }
  assertDatasets(config, payload.layer);
  insertLayer(visState, payload.layer, payload.insertIndex);
  return projection(
    operation,
    payload.layer.label,
    { layerId: payload.layer.id, dataId: payload.layer.dataIds[0] || null, label: payload.layer.label },
    {
      before: null,
      after: payload.layer,
      beforeLabel: "Camada inexistente",
      afterLabel: payload.layer.label,
      beforeOrder: currentOrder({ ...visState, layers: visState.layers.filter((layer) => rawLayerId(layer) !== payload.layer.id) }),
      afterOrder: currentOrder(visState),
    },
  );
}

function applyDuplicate(config, operation) {
  const payload = normalizeDuplicate(operation.payload);
  const visState = ensureVisState(config);
  const source = visState.layers.find((layer) => rawLayerId(layer) === payload.sourceLayerId);
  if (!source) {
    throw failure(
      "A camada de origem da duplicação não existe mais.",
      "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
      { layerId: payload.sourceLayerId },
      409,
    );
  }
  if (!equal(canonicalRawLayer(source), payload.source)) {
    throw failure(
      "A camada de origem divergiu do estado-base da duplicação.",
      "CHANGE_REQUEST_OPERATION_TARGET_CONFLICT",
      { layerId: payload.sourceLayerId },
      409,
    );
  }
  if (visState.layers.some((layer) => rawLayerId(layer) === payload.layer.id)) {
    throw failure(
      "Já existe uma camada com o identificador da duplicação.",
      "CHANGE_REQUEST_OPERATION_TARGET_CONFLICT",
      { layerId: payload.layer.id },
      409,
    );
  }
  assertDatasets(config, payload.layer);
  const beforeOrder = currentOrder(visState);
  insertLayer(visState, payload.layer, payload.insertIndex);
  return projection(
    operation,
    payload.layer.label,
    { layerId: payload.layer.id, dataId: payload.layer.dataIds[0] || null, label: payload.layer.label },
    {
      source: payload.source,
      before: null,
      after: payload.layer,
      beforeLabel: "Camada inexistente",
      afterLabel: payload.layer.label,
      beforeOrder,
      afterOrder: currentOrder(visState),
    },
  );
}

function applyRemove(config, operation) {
  const payload = normalizeRemove(operation.payload);
  const visState = ensureVisState(config);
  const index = visState.layers.findIndex((layer) => rawLayerId(layer) === payload.targetLayerId);
  if (index < 0) {
    throw failure(
      "A camada de destino da remoção não existe mais.",
      "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
      { layerId: payload.targetLayerId },
      409,
    );
  }
  const current = canonicalRawLayer(visState.layers[index]);
  if (!equal(current, payload.before)) {
    throw failure(
      "A camada de destino divergiu do estado-base da remoção.",
      "CHANGE_REQUEST_OPERATION_TARGET_CONFLICT",
      { layerId: payload.targetLayerId },
      409,
    );
  }
  const beforeOrder = currentOrder(visState);
  visState.layers.splice(index, 1);
  const afterOrder = beforeOrder.filter((id) => id !== payload.targetLayerId);
  const byId = new Map(visState.layers.map((layer) => [rawLayerId(layer), layer]));
  visState.layers = afterOrder.map((id) => byId.get(id)).filter(Boolean);
  visState.layerOrder = [...afterOrder];
  return projection(
    operation,
    payload.before.label,
    { layerId: payload.targetLayerId, dataId: payload.before.dataIds[0] || null, label: payload.before.label },
    {
      before: payload.before,
      after: null,
      beforeLabel: payload.before.label,
      afterLabel: "Camada removida",
      beforeOrder,
      afterOrder,
    },
  );
}

export function applyLayerLifecycleOperation(config, operation) {
  validateLayerLifecycleOperation(operation);
  if (operation.type === "layer.create") return applyCreate(config, operation);
  if (operation.type === "layer.duplicate") return applyDuplicate(config, operation);
  return applyRemove(config, operation);
}
