import type { MapFilterSummary } from "../engine-adapter/types";

export type ViewerLayerVisibilityUpdatePayload = {
  targetLayerId: string;
  targetDataId: string | null;
  targetLabel: string;
  before: boolean;
  after: boolean;
};

export type ViewerPersistentFilterType =
  | "range"
  | "timeRange"
  | "multiSelect"
  | "select";

export type ViewerFilterPrimitive = string | number | boolean | null;

export type ViewerPersistentFilterSnapshot = {
  id: string;
  dataIds: string[];
  fieldNames: string[];
  type: ViewerPersistentFilterType;
  value: ViewerFilterPrimitive | ViewerFilterPrimitive[];
  enabled: boolean;
};

export type ViewerPersistentFilterUpdatePayload = {
  filterId: string;
  before: ViewerPersistentFilterSnapshot | null;
  after: ViewerPersistentFilterSnapshot | null;
};

export type ViewerLayerOrderUpdatePayload = {
  before: string[];
  after: string[];
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown, maximum = 200) {
  const normalized = String(value ?? "").trim();
  return normalized && normalized.length <= maximum ? normalized : "";
}

function primitive(value: unknown): value is ViewerFilterPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function cloneValue(value: unknown): ViewerFilterPrimitive | ViewerFilterPrimitive[] | null {
  if (primitive(value)) return value;
  if (Array.isArray(value) && value.length <= 5_000 && value.every(primitive)) {
    return [...value];
  }
  return null;
}

function validFilterType(value: unknown): value is ViewerPersistentFilterType {
  return (
    value === "range" ||
    value === "timeRange" ||
    value === "multiSelect" ||
    value === "select"
  );
}

function stringList(value: unknown, maximum = 500) {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const normalized = value.map((item) => text(item));
  if (normalized.some((item) => !item)) return null;
  return normalized;
}

export function validateViewerLayerVisibilityPayload(payload: unknown) {
  const source = record(payload);
  if (
    !source ||
    !text(source.targetLayerId) ||
    (source.targetDataId != null && !text(source.targetDataId)) ||
    !text(source.targetLabel, 300) ||
    typeof source.before !== "boolean" ||
    typeof source.after !== "boolean" ||
    source.before === source.after
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
}

export function validateViewerFilterSnapshot(value: unknown) {
  const source = record(value);
  if (!source || !text(source.id) || !validFilterType(source.type)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  const dataIds = stringList(source.dataIds, 20);
  const fieldNames = stringList(source.fieldNames, 20);
  if (!dataIds?.length || !fieldNames?.length || typeof source.enabled !== "boolean") {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  const normalizedValue = cloneValue(source.value);
  if (normalizedValue === null && source.value !== null) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  if (
    (source.type === "range" || source.type === "timeRange") &&
    (!Array.isArray(normalizedValue) ||
      normalizedValue.length !== 2 ||
      normalizedValue.some((item) => typeof item !== "number" || !Number.isFinite(item)))
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  if (source.type === "select" && typeof normalizedValue !== "boolean") {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  if (source.type === "multiSelect" && !Array.isArray(normalizedValue)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
}

export function validateViewerPersistentFilterPayload(payload: unknown) {
  const source = record(payload);
  if (!source || !text(source.filterId)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  const before = source.before;
  const after = source.after;
  if (before == null && after == null) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  if (before != null) validateViewerFilterSnapshot(before);
  if (after != null) validateViewerFilterSnapshot(after);
  const beforeId = before == null ? "" : text(record(before)?.id);
  const afterId = after == null ? "" : text(record(after)?.id);
  if ((beforeId && beforeId !== text(source.filterId)) || (afterId && afterId !== text(source.filterId))) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
  if (viewerJsonEqual(before, after)) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
}

export function validateViewerLayerOrderPayload(payload: unknown) {
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
    viewerJsonEqual(before, after)
  ) {
    throw new Error("WORKING_COPY_OPERATION_INVALID");
  }
}

export function snapshotViewerPersistentFilter(
  filter: MapFilterSummary,
  logicalId = filter.id,
): ViewerPersistentFilterSnapshot | null {
  if (
    !filter.compatible ||
    !validFilterType(filter.type) ||
    !text(logicalId) ||
    !filter.dataIds.length ||
    !filter.fieldNames.length
  ) {
    return null;
  }
  const value = cloneValue(filter.value);
  if (value === null && filter.value !== null) return null;
  const snapshot: ViewerPersistentFilterSnapshot = {
    id: logicalId,
    dataIds: [...filter.dataIds],
    fieldNames: [...filter.fieldNames],
    type: filter.type,
    value: value as ViewerPersistentFilterSnapshot["value"],
    enabled: filter.enabled,
  };
  try {
    validateViewerFilterSnapshot(snapshot);
    return snapshot;
  } catch {
    return null;
  }
}

export function viewerJsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function layerOrderFromIds(ids: Iterable<string>) {
  return Array.from(ids, (id) => String(id || "").trim()).filter(Boolean);
}

export function viewerPersistentFilterDescription(
  snapshot: ViewerPersistentFilterSnapshot | null,
) {
  if (!snapshot) return "Sem filtro";
  const fields = snapshot.fieldNames.join(", ");
  const value = Array.isArray(snapshot.value)
    ? snapshot.value.join(" – ")
    : String(snapshot.value);
  return `${fields}: ${value}${snapshot.enabled ? "" : " (desativado)"}`;
}
