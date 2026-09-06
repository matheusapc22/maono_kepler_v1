const SUPPORTED_LAYER_TYPES = new Set(["point", "cluster", "heatmap", "geojson"]);
const COLOR_SCALES = new Set(["quantile", "quantize", "linear", "sqrt", "log", "ordinal"]);
const LAYER_BLEND = new Set(["normal", "additive", "subtractive"]);
const OVERLAY_BLEND = new Set(["normal", "screen", "darken"]);
const PERSISTENT_MUTATION_TYPES = new Set([
  "layer.definition.update",
  "tooltip.config.update",
  "map.blending.update",
]);

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
  const expected = new Set(allowed);
  return Object.keys(value).every((key) => expected.has(key));
}

function ensureVisState(config) {
  if (!record(config.config)) config.config = {};
  if (!record(config.config.visState)) config.config.visState = {};
  if (!Array.isArray(config.config.visState.layers)) config.config.visState.layers = [];
  return config.config.visState;
}

function rawLayerId(layer) {
  return text(layer?.id, 200);
}

function rawDataIds(layer) {
  const raw = layer?.config?.dataId ?? layer?.dataId;
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  return Array.from(new Set(list.map((item) => text(item, 200)).filter(Boolean)));
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
  const normalized = String(value ?? "").trim().toLowerCase();
  return COLOR_SCALES.has(normalized) ? normalized : null;
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

function validPalette(value) {
  if (
    !Array.isArray(value) ||
    value.length > 20 ||
    value.some((color) => typeof color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(color))
  ) {
    throw failure("A definição da camada contém uma paleta inválida.");
  }
  return value.map(String);
}

function normalizeDefinition(value) {
  const source = record(value);
  if (
    !source ||
    !exactKeys(source, [
      "type",
      "dataIds",
      "label",
      "columns",
      "colorField",
      "colorScale",
      "colorPalette",
      "colorPaletteId",
      "strokeColorField",
      "strokeColorScale",
      "strokeColorPalette",
      "strokeColorPaletteId",
      "radiusField",
      "radiusScale",
      "radiusRange",
    ])
  ) {
    throw failure("Definição persistente de camada inválida.");
  }
  const type = text(source.type, 40).toLowerCase();
  const label = text(source.label, 300);
  if (!SUPPORTED_LAYER_TYPES.has(type) || !label) {
    throw failure("Definição persistente de camada inválida.");
  }
  if (!Array.isArray(source.dataIds) || source.dataIds.length < 1 || source.dataIds.length > 20) {
    throw failure("A definição da camada possui datasets inválidos.");
  }
  const dataIds = source.dataIds.map((item) => text(item, 200));
  if (dataIds.some((id) => !id) || new Set(dataIds).size !== dataIds.length) {
    throw failure("A definição da camada possui datasets inválidos.");
  }
  const columnsSource = record(source.columns);
  if (!columnsSource || !exactKeys(columnsSource, ["latitude", "longitude", "geojson", "altitude"])) {
    throw failure("A definição da camada possui colunas inválidas.");
  }
  const columns = {
    latitude: optionalText(columnsSource.latitude, 200),
    longitude: optionalText(columnsSource.longitude, 200),
    geojson: optionalText(columnsSource.geojson, 200),
    altitude: optionalText(columnsSource.altitude, 200),
  };
  if (type === "geojson" && !columns.geojson) {
    throw failure("Camada GeoJSON exige coluna de geometria.", "CHANGE_REQUEST_OPERATION_TARGET_INVALID", null, 409);
  }
  if (type !== "geojson" && (!columns.latitude || !columns.longitude)) {
    throw failure("Camada de pontos exige latitude e longitude.", "CHANGE_REQUEST_OPERATION_TARGET_INVALID", null, 409);
  }

  const colorScale = source.colorScale == null ? null : rawScale(source.colorScale);
  const strokeColorScale = source.strokeColorScale == null ? null : rawScale(source.strokeColorScale);
  if (source.colorScale != null && !colorScale) throw failure("Escala de cor inválida.");
  if (source.strokeColorScale != null && !strokeColorScale) throw failure("Escala de contorno inválida.");

  let radiusRange = null;
  if (source.radiusRange != null) {
    if (!Array.isArray(source.radiusRange) || source.radiusRange.length !== 2) {
      throw failure("Faixa de raio inválida.");
    }
    radiusRange = source.radiusRange.map(Number);
    if (
      radiusRange.some((entry) => !Number.isFinite(entry) || entry < 0 || entry > 10_000) ||
      radiusRange[0] > radiusRange[1]
    ) {
      throw failure("Faixa de raio inválida.");
    }
  }

  return {
    type,
    dataIds,
    label,
    columns,
    colorField: optionalText(source.colorField, 200),
    colorScale,
    colorPalette: validPalette(source.colorPalette),
    colorPaletteId: optionalText(source.colorPaletteId, 120),
    strokeColorField: optionalText(source.strokeColorField, 200),
    strokeColorScale,
    strokeColorPalette: validPalette(source.strokeColorPalette),
    strokeColorPaletteId: optionalText(source.strokeColorPaletteId, 120),
    radiusField: optionalText(source.radiusField, 200),
    radiusScale: optionalText(source.radiusScale, 80),
    radiusRange,
  };
}

function canonicalDefinition(layer) {
  const config = record(layer?.config) || {};
  const vis = record(config.visConfig) || {};
  const columns = record(config.columns) || {};
  return normalizeDefinition({
    type: text(layer?.type, 40).toLowerCase(),
    dataIds: rawDataIds(layer),
    label: text(config.label || rawLayerId(layer), 300),
    columns: {
      latitude: rawColumn(columns.lat ?? columns.latitude),
      longitude: rawColumn(columns.lng ?? columns.longitude),
      geojson: rawColumn(columns.geojson ?? columns.geometry),
      altitude: rawColumn(columns.altitude ?? columns.height),
    },
    colorField: rawField(config.colorField ?? layer?.colorField),
    colorScale: rawScale(config.colorScale ?? vis.colorScale),
    colorPalette: rawPalette(vis.colorRange),
    colorPaletteId: rawPaletteId(vis.colorRange),
    strokeColorField: rawField(config.strokeColorField ?? layer?.strokeColorField),
    strokeColorScale: rawScale(config.strokeColorScale ?? vis.strokeColorScale),
    strokeColorPalette: rawPalette(vis.strokeColorRange),
    strokeColorPaletteId: rawPaletteId(vis.strokeColorRange),
    radiusField: rawField(config.sizeField ?? config.radiusField ?? layer?.sizeField ?? layer?.radiusField),
    radiusScale: optionalText(config.sizeScale ?? config.radiusScale ?? vis.sizeScale, 80),
    radiusRange: Array.isArray(vis.radiusRange) && vis.radiusRange.length === 2
      ? vis.radiusRange.map(Number)
      : null,
  });
}

function datasetId(dataset) {
  return text(dataset?.data?.id ?? dataset?.info?.id ?? dataset?.id, 200);
}

function assertDatasets(config, definition) {
  const datasets = Array.isArray(config.datasets) ? config.datasets : [];
  for (const dataId of definition.dataIds) {
    if (!datasets.some((dataset) => datasetId(dataset) === dataId)) {
      throw failure(
        "O dataset associado à camada não existe mais.",
        "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
        { dataId },
        409,
      );
    }
  }
}

function colorRange(colors, id) {
  if (!colors.length) return undefined;
  return {
    name: `maono:${id || "custom"}`,
    type: "sequential",
    category: "Maõno",
    colors: [...colors],
  };
}

function applyDefinitionToLayer(layer, definition) {
  if (!record(layer.config)) layer.config = {};
  const config = layer.config;
  if (!record(config.visConfig)) config.visConfig = {};
  const vis = config.visConfig;

  layer.type = definition.type;
  config.dataId = definition.dataIds.length === 1 ? definition.dataIds[0] : [...definition.dataIds];
  config.label = definition.label;
  config.columns = definition.type === "geojson"
    ? { geojson: definition.columns.geojson }
    : {
        lat: definition.columns.latitude,
        lng: definition.columns.longitude,
        altitude: definition.columns.altitude,
      };
  config.colorField = definition.colorField;
  config.colorScale = definition.colorScale;
  config.strokeColorField = definition.strokeColorField;
  config.strokeColorScale = definition.strokeColorScale;
  config.sizeField = definition.radiusField;
  config.sizeScale = definition.radiusScale;

  if (definition.radiusRange) vis.radiusRange = [...definition.radiusRange];
  else delete vis.radiusRange;
  const fillRange = colorRange(definition.colorPalette, definition.colorPaletteId);
  const strokeRange = colorRange(definition.strokeColorPalette, definition.strokeColorPaletteId);
  if (fillRange) vis.colorRange = fillRange;
  else delete vis.colorRange;
  if (strokeRange) vis.strokeColorRange = strokeRange;
  else delete vis.strokeColorRange;
}

function normalizeDefinitionPayload(payload) {
  const source = record(payload);
  if (!source || !exactKeys(source, ["targetLayerId", "before", "after"])) {
    throw failure("Payload de layer.definition.update inválido.");
  }
  const targetLayerId = text(source.targetLayerId, 200);
  const before = normalizeDefinition(source.before);
  const after = normalizeDefinition(source.after);
  if (!targetLayerId || equal(before, after)) {
    throw failure("Payload de layer.definition.update inválido.");
  }
  return { targetLayerId, before, after };
}

function tooltipField(value) {
  const source = record(value);
  if (!source || !exactKeys(source, ["name", "format"])) {
    throw failure("Campo de tooltip inválido.");
  }
  const name = text(source.name, 200);
  if (!name) throw failure("Campo de tooltip inválido.");
  return {
    name,
    format: source.format == null ? null : text(source.format, 120) || null,
  };
}

function normalizeTooltip(value) {
  const source = record(value);
  if (!source || !exactKeys(source, ["enabled", "fieldsByDataset"]) || typeof source.enabled !== "boolean") {
    throw failure("Snapshot de tooltip inválido.");
  }
  const rawFields = record(source.fieldsByDataset);
  if (!rawFields || Object.keys(rawFields).length > 100) {
    throw failure("Snapshot de tooltip inválido.");
  }
  const fieldsByDataset = {};
  for (const [dataId, fields] of Object.entries(rawFields)) {
    const id = text(dataId, 200);
    if (!id || !Array.isArray(fields) || fields.length > 100) {
      throw failure("Snapshot de tooltip inválido.");
    }
    fieldsByDataset[id] = fields.map(tooltipField);
  }
  return { enabled: source.enabled, fieldsByDataset };
}

function normalizeTooltipPayload(payload) {
  const source = record(payload);
  if (!source || !exactKeys(source, ["before", "after"])) {
    throw failure("Payload de tooltip.config.update inválido.");
  }
  const before = normalizeTooltip(source.before);
  const after = normalizeTooltip(source.after);
  if (equal(before, after)) throw failure("Tooltip não contém alteração persistente.");
  return { before, after };
}

function canonicalTooltip(visState) {
  const interaction = record(visState.interactionConfig) || {};
  const tooltip = record(interaction.tooltip) || {};
  const config = record(tooltip.config) || {};
  const fields = record(config.fieldsToShow) || {};
  return normalizeTooltip({
    enabled: tooltip.enabled !== false,
    fieldsByDataset: Object.fromEntries(
      Object.entries(fields).map(([dataId, values]) => [
        dataId,
        Array.isArray(values)
          ? values.flatMap((value) => {
              const item = record(value);
              const name = text(item?.name, 200);
              return name ? [{ name, format: item?.format == null ? null : String(item.format) }] : [];
            })
          : [],
      ]),
    ),
  });
}

function datasetFields(config, dataId) {
  const dataset = (Array.isArray(config.datasets) ? config.datasets : []).find(
    (candidate) => datasetId(candidate) === dataId,
  );
  const fields = dataset?.data?.fields ?? dataset?.fields ?? [];
  return new Set(
    (Array.isArray(fields) ? fields : [])
      .map((field) => text(field?.name, 200))
      .filter(Boolean),
  );
}

function assertTooltipTargets(config, snapshot) {
  for (const [dataId, fields] of Object.entries(snapshot.fieldsByDataset)) {
    const available = datasetFields(config, dataId);
    if (!available.size) {
      throw failure(
        "O dataset do tooltip não existe mais.",
        "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
        { dataId },
        409,
      );
    }
    const missing = fields.find((field) => !available.has(field.name));
    if (missing) {
      throw failure(
        "Um campo configurado no tooltip não existe mais.",
        "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
        { dataId, fieldName: missing.name },
        409,
      );
    }
  }
}

function applyTooltip(visState, snapshot) {
  if (!record(visState.interactionConfig)) visState.interactionConfig = {};
  if (!record(visState.interactionConfig.tooltip)) visState.interactionConfig.tooltip = {};
  const tooltip = visState.interactionConfig.tooltip;
  if (!record(tooltip.config)) tooltip.config = {};
  tooltip.enabled = snapshot.enabled;
  tooltip.config.fieldsToShow = clone(snapshot.fieldsByDataset);
}

function normalizeBlending(value) {
  const source = record(value);
  if (!source || !exactKeys(source, ["layers", "overlays"])) {
    throw failure("Snapshot de blending inválido.");
  }
  const layers = String(source.layers || "");
  const overlays = String(source.overlays || "");
  if (!LAYER_BLEND.has(layers) || !OVERLAY_BLEND.has(overlays)) {
    throw failure("Snapshot de blending inválido.");
  }
  return { layers, overlays };
}

function normalizeBlendingPayload(payload) {
  const source = record(payload);
  if (!source || !exactKeys(source, ["before", "after"])) {
    throw failure("Payload de map.blending.update inválido.");
  }
  const before = normalizeBlending(source.before);
  const after = normalizeBlending(source.after);
  if (equal(before, after)) throw failure("Blending não contém alteração persistente.");
  return { before, after };
}

function canonicalBlending(visState) {
  const layers = LAYER_BLEND.has(String(visState.layerBlending))
    ? String(visState.layerBlending)
    : "normal";
  const overlays = OVERLAY_BLEND.has(String(visState.overlayBlending))
    ? String(visState.overlayBlending)
    : "normal";
  return { layers, overlays };
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

export function isPersistentViewerMutationOperation(operation) {
  return PERSISTENT_MUTATION_TYPES.has(String(operation?.type || "").trim());
}

export function validatePersistentViewerMutationOperation(operation) {
  if (!isPersistentViewerMutationOperation(operation) || Number(operation?.version) !== 1) {
    throw failure(
      "Tipo ou versão de mutação persistente não suportado.",
      "CHANGE_REQUEST_OPERATION_VERSION_UNSUPPORTED",
    );
  }
  if (operation.type === "layer.definition.update") return normalizeDefinitionPayload(operation.payload);
  if (operation.type === "tooltip.config.update") return normalizeTooltipPayload(operation.payload);
  return normalizeBlendingPayload(operation.payload);
}

function applyLayerDefinition(config, operation) {
  const payload = normalizeDefinitionPayload(operation.payload);
  const visState = ensureVisState(config);
  const layer = visState.layers.find((candidate) => rawLayerId(candidate) === payload.targetLayerId);
  if (!layer) {
    throw failure(
      "A camada de destino não existe mais.",
      "CHANGE_REQUEST_OPERATION_TARGET_MISSING",
      { layerId: payload.targetLayerId },
      409,
    );
  }
  const current = canonicalDefinition(layer);
  if (!equal(current, payload.before)) {
    throw failure(
      "A definição da camada divergiu do estado-base da solicitação.",
      "CHANGE_REQUEST_OPERATION_TARGET_CONFLICT",
      { layerId: payload.targetLayerId },
      409,
    );
  }
  assertDatasets(config, payload.after);
  applyDefinitionToLayer(layer, payload.after);
  return projection(
    operation,
    payload.after.label,
    {
      layerId: payload.targetLayerId,
      dataId: payload.after.dataIds[0] || null,
      label: payload.after.label,
    },
    { before: payload.before, after: payload.after },
  );
}

function applyTooltipUpdate(config, operation) {
  const payload = normalizeTooltipPayload(operation.payload);
  const visState = ensureVisState(config);
  const current = canonicalTooltip(visState);
  if (!equal(current, payload.before)) {
    throw failure(
      "A configuração de tooltip divergiu do estado-base.",
      "CHANGE_REQUEST_OPERATION_TARGET_CONFLICT",
      null,
      409,
    );
  }
  assertTooltipTargets(config, payload.after);
  applyTooltip(visState, payload.after);
  return projection(
    operation,
    "Tooltip",
    { layerId: null, dataId: null, label: "Tooltip" },
    { before: payload.before, after: payload.after },
  );
}

function applyBlendingUpdate(config, operation) {
  const payload = normalizeBlendingPayload(operation.payload);
  const visState = ensureVisState(config);
  const current = canonicalBlending(visState);
  if (!equal(current, payload.before)) {
    throw failure(
      "A configuração de blending divergiu do estado-base.",
      "CHANGE_REQUEST_OPERATION_TARGET_CONFLICT",
      null,
      409,
    );
  }
  visState.layerBlending = payload.after.layers;
  visState.overlayBlending = payload.after.overlays;
  return projection(
    operation,
    "Composição visual",
    { layerId: null, dataId: null, label: "Composição visual" },
    { before: payload.before, after: payload.after },
  );
}

export function applyPersistentViewerMutationOperation(config, operation) {
  validatePersistentViewerMutationOperation(operation);
  if (operation.type === "layer.definition.update") {
    return applyLayerDefinition(config, operation);
  }
  if (operation.type === "tooltip.config.update") {
    return applyTooltipUpdate(config, operation);
  }
  return applyBlendingUpdate(config, operation);
}
