import type {
  ViewerLayerCreatePayload,
  ViewerLayerDuplicatePayload,
  ViewerLayerRemovePayload,
  ViewerLayerSnapshot,
} from "./viewer-layer-lifecycle";
import type {
  ProjectChangeReview,
  ReviewOperationProjection,
  ReviewSourceOperation,
} from "./review-api";

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type Rgb = [number, number, number];

type StyleSnapshot = Partial<{
  fixedColor: Rgb | null;
  opacity: number | null;
  fillEnabled: boolean | null;
  strokeEnabled: boolean | null;
  strokeColor: Rgb | null;
  strokeOpacity: number | null;
  strokeWidth: number | null;
  pointRadius: number | null;
  clusterRadius: number | null;
  heatmapRadius: number | null;
}>;

type VirtualLayer = {
  id: string;
  dataId: string | null;
  label: string;
  type: string;
  visible: boolean;
  style: StyleSnapshot;
};

function rgb(value: unknown): Rgb | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const channels = value.map(Number);
  if (
    channels.some(
      (channel) => !Number.isFinite(channel) || channel < 0 || channel > 255,
    )
  ) {
    return null;
  }
  return [channels[0], channels[1], channels[2]];
}

function layerDataId(layer: Record<string, any>) {
  const raw = layer?.config?.dataId ?? layer?.dataId;
  if (Array.isArray(raw)) return text(raw[0]) || null;
  return text(raw) || null;
}

function styleSnapshotFromLayer(layer: Record<string, any>): StyleSnapshot {
  const config = record(layer.config) || {};
  const visConfig = record(config.visConfig) || {};
  const layerType = text(layer.type).toLowerCase();
  return {
    fixedColor: rgb(config.color),
    opacity: visConfig.opacity ?? null,
    fillEnabled: visConfig.filled ?? null,
    strokeEnabled:
      layerType === "point"
        ? visConfig.outline ?? null
        : visConfig.stroked ?? null,
    strokeColor: rgb(visConfig.strokeColor),
    strokeOpacity: visConfig.strokeOpacity ?? null,
    strokeWidth: visConfig.thickness ?? visConfig.strokeWidth ?? null,
    pointRadius: visConfig.radius ?? null,
    clusterRadius: visConfig.clusterRadius ?? null,
    heatmapRadius: visConfig.heatmapRadius ?? null,
  };
}

function styleSnapshotFromLifecycle(layer: ViewerLayerSnapshot): StyleSnapshot {
  return {
    fixedColor: [...layer.style.color] as Rgb,
    opacity: layer.style.opacity,
    fillEnabled: layer.style.fillEnabled,
    strokeEnabled: layer.style.strokeEnabled,
    strokeColor: [...layer.style.strokeColor] as Rgb,
    strokeOpacity: layer.style.strokeOpacity,
    strokeWidth: layer.style.strokeWidth,
    pointRadius: layer.style.pointRadius,
    clusterRadius: layer.style.clusterRadius,
    heatmapRadius: layer.style.heatmapRadius,
  };
}

function virtualLayerFromLifecycle(layer: ViewerLayerSnapshot): VirtualLayer {
  return {
    id: layer.id,
    dataId: layer.dataIds[0] || null,
    label: layer.label,
    type: layer.type,
    visible: layer.isVisible,
    style: styleSnapshotFromLifecycle(layer),
  };
}

function baseLayers(baseConfig: unknown) {
  const root = record(baseConfig);
  const visState = record(root?.config)?.visState;
  const layers = Array.isArray(visState?.layers) ? visState.layers : [];
  const result = new Map<string, VirtualLayer>();
  for (const candidate of layers) {
    const layer = record(candidate);
    const id = text(layer?.id);
    if (!layer || !id) continue;
    const config = record(layer.config) || {};
    result.set(id, {
      id,
      dataId: layerDataId(layer),
      label: text(config.label) || id,
      type: text(layer.type),
      visible: config.isVisible !== false,
      style: styleSnapshotFromLayer(layer),
    });
  }
  return result;
}

function applyStyleChanges(
  before: StyleSnapshot,
  changes: Record<string, any>,
): StyleSnapshot {
  const after = clone(before);
  for (const key of [
    "fixedColor",
    "opacity",
    "fillEnabled",
    "strokeEnabled",
    "strokeColor",
    "strokeOpacity",
    "strokeWidth",
    "pointRadius",
    "clusterRadius",
    "heatmapRadius",
  ] as const) {
    if (key in changes) {
      (after as Record<string, unknown>)[key] = clone(changes[key]);
    }
  }
  return after;
}

function newPointStyle(): StyleSnapshot {
  return {
    fixedColor: [197, 160, 89],
    opacity: 0.8,
    fillEnabled: null,
    strokeEnabled: false,
    strokeColor: null,
    strokeOpacity: null,
    strokeWidth: null,
    pointRadius: 10,
    clusterRadius: null,
    heatmapRadius: null,
  };
}

function newAnalysisStyle(kind: string): StyleSnapshot {
  return {
    fixedColor: [197, 160, 89],
    opacity: kind === "buffer" ? 0.2 : 0.28,
    fillEnabled: true,
    strokeEnabled: true,
    strokeColor: [183, 121, 31],
    strokeOpacity: 0.95,
    strokeWidth: 1.5,
    pointRadius: null,
    clusterRadius: null,
    heatmapRadius: null,
  };
}

function projectionBase(
  operation: ReviewSourceOperation,
  type: ReviewOperationProjection["type"],
) {
  return {
    id: text(operation.id),
    sequence: Number(operation.sequence ?? 0),
    type,
    version: Number(operation.version || 1),
  };
}

function lifecyclePayload<T>(operation: ReviewSourceOperation): T {
  const payload = record(operation.payload);
  if (!payload) throw new Error(`Payload inválido em ${operation.type}.`);
  return payload as T;
}

function projectLifecycle(
  operation: ReviewSourceOperation,
  layers: Map<string, VirtualLayer>,
): ReviewOperationProjection {
  if (operation.type === "layer.create") {
    const payload = lifecyclePayload<ViewerLayerCreatePayload>(operation);
    if (layers.has(payload.layer.id)) {
      throw new Error(`A camada ${payload.layer.id} já existe na revisão-base.`);
    }
    layers.set(payload.layer.id, virtualLayerFromLifecycle(payload.layer));
    return {
      ...projectionBase(operation, "layer.create"),
      label: payload.layer.label,
      focus: null,
      target: {
        layerId: payload.layer.id,
        dataId: payload.layer.dataIds[0] || null,
        label: payload.layer.label,
      },
      overlay: null,
      properties: {
        before: null,
        after: clone(payload.layer),
        beforeLabel: "Camada inexistente",
        afterLabel: payload.layer.label,
        insertIndex: payload.insertIndex,
      },
    };
  }

  if (operation.type === "layer.duplicate") {
    const payload = lifecyclePayload<ViewerLayerDuplicatePayload>(operation);
    if (!layers.has(payload.sourceLayerId)) {
      throw new Error(`A camada ${payload.sourceLayerId} não existe para duplicação.`);
    }
    if (layers.has(payload.layer.id)) {
      throw new Error(`A camada ${payload.layer.id} já existe na revisão-base.`);
    }
    layers.set(payload.layer.id, virtualLayerFromLifecycle(payload.layer));
    return {
      ...projectionBase(operation, "layer.duplicate"),
      label: payload.layer.label,
      focus: null,
      target: {
        layerId: payload.layer.id,
        dataId: payload.layer.dataIds[0] || null,
        label: payload.layer.label,
      },
      overlay: null,
      properties: {
        source: clone(payload.source),
        sourceLayerId: payload.sourceLayerId,
        before: null,
        after: clone(payload.layer),
        beforeLabel: "Camada inexistente",
        afterLabel: payload.layer.label,
        insertIndex: payload.insertIndex,
      },
    };
  }

  const payload = lifecyclePayload<ViewerLayerRemovePayload>(operation);
  const layer = layers.get(payload.targetLayerId);
  if (!layer) {
    throw new Error(`A camada ${payload.targetLayerId} não existe para remoção.`);
  }
  layers.delete(payload.targetLayerId);
  return {
    ...projectionBase(operation, "layer.remove"),
    label: payload.before.label || layer.label,
    focus: null,
    target: {
      layerId: payload.targetLayerId,
      dataId: payload.before.dataIds[0] || layer.dataId,
      label: payload.before.label || layer.label,
    },
    overlay: null,
    properties: {
      before: clone(payload.before),
      after: null,
      beforeLabel: payload.before.label || layer.label,
      afterLabel: "Camada removida",
      previousIndex: payload.previousIndex,
    },
  };
}

function projectPoint(
  operation: ReviewSourceOperation,
  layers: Map<string, VirtualLayer>,
): ReviewOperationProjection {
  const payload = record(operation.payload) || {};
  const properties = record(payload.properties) || {};
  const layerId = text(payload.targetLayerId) || null;
  const dataId = text(payload.targetDataId) || null;
  const label = text(payload.targetLabel) || "Camada de pontos";
  if (text(payload.targetMode).toLowerCase() === "new" && layerId) {
    layers.set(layerId, {
      id: layerId,
      dataId,
      label,
      type: "point",
      visible: true,
      style: newPointStyle(),
    });
  }
  return {
    ...projectionBase(operation, "point.create"),
    label: text(properties.name) || label || "Novo ponto",
    focus: {
      latitude: Number(payload.latitude),
      longitude: Number(payload.longitude),
    },
    target: { layerId, dataId, label },
    overlay: {
      kind: "point",
      latitude: Number(payload.latitude),
      longitude: Number(payload.longitude),
    },
    properties: clone(properties),
  };
}

function projectAnalysis(
  operation: ReviewSourceOperation,
  layers: Map<string, VirtualLayer>,
): ReviewOperationProjection {
  const payload = record(operation.payload) || {};
  const parameters = record(payload.parameters) || {};
  const kind = text(payload.analysisKind);
  const layerId = text(payload.targetLayerId) || null;
  const dataId = text(payload.targetDataId) || null;
  const label =
    text(payload.targetLabel) || (kind === "buffer" ? "Buffer" : "Isócrona");
  if (layerId) {
    layers.set(layerId, {
      id: layerId,
      dataId,
      label,
      type: "geojson",
      visible: true,
      style: newAnalysisStyle(kind),
    });
  }
  const origin =
    kind === "isochrone"
      ? record(parameters.origin)
      : record(
          Array.isArray(parameters.items) ? parameters.items[0]?.origin : null,
        );
  const properties =
    kind === "buffer"
      ? {
          itemCount: Array.isArray(parameters.items) ? parameters.items.length : 0,
          items: clone(Array.isArray(parameters.items) ? parameters.items : []),
        }
      : {
          origin: clone(record(parameters.origin) || {}),
          metadata: clone(record(parameters.metadata) || {}),
        };
  return {
    ...projectionBase(
      operation,
      kind === "buffer" ? "buffer.create" : "isochrone.create",
    ),
    label,
    focus: origin
      ? {
          latitude: Number(origin.latitude),
          longitude: Number(origin.longitude),
        }
      : null,
    target: { layerId, dataId, label },
    overlay: record(payload.geojson)
      ? { kind: "geojson", geojson: clone(payload.geojson) }
      : null,
    properties,
  };
}

function projectStyle(
  operation: ReviewSourceOperation,
  layers: Map<string, VirtualLayer>,
): ReviewOperationProjection {
  const payload = record(operation.payload) || {};
  const changes = record(payload.changes) || {};
  const layerId = text(payload.targetLayerId);
  const layer = layers.get(layerId);
  if (!layer) {
    throw new Error(
      `A camada ${layerId || "de estilo"} não existe na revisão-base.`,
    );
  }
  const before = clone(layer.style);
  const after = applyStyleChanges(before, changes);
  layer.style = clone(after);
  return {
    ...projectionBase(operation, "layer.style.update"),
    label: text(payload.targetLabel) || layer.label || layerId,
    focus: null,
    target: {
      layerId,
      dataId: text(payload.targetDataId) || layer.dataId,
      label: text(payload.targetLabel) || layer.label || layerId,
    },
    overlay: null,
    properties: { before, after, changes: clone(changes) },
  };
}

function projectPersistent(
  operation: ReviewSourceOperation,
  layers: Map<string, VirtualLayer>,
): ReviewOperationProjection {
  const payload = record(operation.payload) || {};
  if (operation.type === "layer.visibility.update") {
    const layerId = text(payload.targetLayerId);
    const layer = layers.get(layerId);
    if (layer && typeof payload.after === "boolean") layer.visible = payload.after;
    return {
      ...projectionBase(operation, "layer.visibility.update"),
      label: text(payload.targetLabel) || layer?.label || layerId,
      focus: null,
      target: {
        layerId: layerId || null,
        dataId: text(payload.targetDataId) || layer?.dataId || null,
        label: text(payload.targetLabel) || layer?.label || layerId || "Camada",
      },
      overlay: null,
      properties: {
        before: payload.before,
        after: payload.after,
        beforeLabel: payload.before ? "Visível" : "Oculta",
        afterLabel: payload.after ? "Visível" : "Oculta",
      },
    };
  }

  if (operation.type === "persistent.filter.update") {
    const target = record(payload.after) || record(payload.before) || {};
    const fields = Array.isArray(target.fieldNames)
      ? target.fieldNames.map(String)
      : [];
    const beforeLabel = payload.before
      ? `${Array.isArray(payload.before.fieldNames) ? payload.before.fieldNames.join(", ") : "Filtro"}: ${Array.isArray(payload.before.value) ? payload.before.value.join(" – ") : String(payload.before.value ?? "—")}`
      : "Sem filtro";
    const afterLabel = payload.after
      ? `${Array.isArray(payload.after.fieldNames) ? payload.after.fieldNames.join(", ") : "Filtro"}: ${Array.isArray(payload.after.value) ? payload.after.value.join(" – ") : String(payload.after.value ?? "—")}`
      : "Sem filtro";
    return {
      ...projectionBase(operation, "persistent.filter.update"),
      label: fields.join(", ") || "Filtro persistente",
      focus: null,
      target: {
        layerId: null,
        dataId: Array.isArray(target.dataIds)
          ? text(target.dataIds[0]) || null
          : null,
        label: fields.join(", ") || "Filtro persistente",
      },
      overlay: null,
      properties: {
        before: clone(payload.before ?? null),
        after: clone(payload.after ?? null),
        beforeLabel,
        afterLabel,
      },
    };
  }

  const before = Array.isArray(payload.before) ? payload.before.map(String) : [];
  const after = Array.isArray(payload.after) ? payload.after.map(String) : [];
  return {
    ...projectionBase(operation, "layer.order.update"),
    label: "Ordem das camadas",
    focus: null,
    target: { layerId: null, dataId: null, label: "Ordem das camadas" },
    overlay: null,
    properties: {
      before,
      after,
      beforeLabel: before.join(" → "),
      afterLabel: after.join(" → "),
    },
  };
}

export function buildReviewOperationProjections(
  baseConfig: unknown,
  operations: ReviewSourceOperation[],
): ReviewOperationProjection[] {
  const layers = baseLayers(baseConfig);
  return [...operations]
    .sort(
      (left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0),
    )
    .map((operation) => {
      if (
        operation.type === "layer.create" ||
        operation.type === "layer.duplicate" ||
        operation.type === "layer.remove"
      ) {
        return projectLifecycle(operation, layers);
      }
      if (operation.type === "point.create") return projectPoint(operation, layers);
      if (operation.type === "layer.style.update") {
        return projectStyle(operation, layers);
      }
      if (
        operation.type === "buffer.create" ||
        operation.type === "isochrone.create"
      ) {
        return projectAnalysis(operation, layers);
      }
      if (
        operation.type === "layer.visibility.update" ||
        operation.type === "persistent.filter.update" ||
        operation.type === "layer.order.update"
      ) {
        return projectPersistent(operation, layers);
      }
      throw new Error(`Operação de Review não suportada: ${operation.type}`);
    });
}

export function materializeProjectChangeReviewProjections(
  review: ProjectChangeReview,
  baseConfig: unknown,
) {
  return buildReviewOperationProjections(baseConfig, review.operations);
}
