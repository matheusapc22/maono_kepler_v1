import type {
  ProjectChangeReview,
  ReviewOperationProjection,
  ReviewSourceOperation,
} from "./review-api.ts";
import {
  buildReviewOperationProjections as buildCoreReviewOperationProjections,
} from "./review-operation-projection-core.ts";

const COVERAGE_TYPES = new Set<ReviewSourceOperation["type"]>([
  "layer.definition.update",
  "tooltip.config.update",
  "map.blending.update",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function baseProjection(
  operation: ReviewSourceOperation,
): Pick<ReviewOperationProjection, "id" | "sequence" | "type" | "version"> {
  return {
    id: text(operation.id),
    sequence: Number(operation.sequence ?? 0),
    type: operation.type,
    version: Number(operation.version ?? 1),
  };
}

function projectCoverageOperation(
  operation: ReviewSourceOperation,
): ReviewOperationProjection {
  const payload = record(operation.payload) || {};

  if (operation.type === "layer.definition.update") {
    const before = record(payload.before) || {};
    const after = record(payload.after) || {};
    const layerId = text(payload.targetLayerId);
    const beforeLabel = text(before.label) || layerId || "Camada";
    const afterLabel = text(after.label) || beforeLabel;
    const dataIds = Array.isArray(after.dataIds) ? after.dataIds.map(String) : [];
    return {
      ...baseProjection(operation),
      type: "layer.definition.update",
      label: afterLabel,
      focus: null,
      target: {
        layerId: layerId || null,
        dataId: text(dataIds[0]) || null,
        label: afterLabel,
      },
      overlay: null,
      properties: {
        before: clone(before),
        after: clone(after),
        beforeLabel,
        afterLabel,
      },
    };
  }

  if (operation.type === "tooltip.config.update") {
    const before = record(payload.before) || {};
    const after = record(payload.after) || {};
    const beforeDatasets = Object.keys(record(before.fieldsByDataset) || {}).length;
    const afterDatasets = Object.keys(record(after.fieldsByDataset) || {}).length;
    return {
      ...baseProjection(operation),
      type: "tooltip.config.update",
      label: "Tooltip",
      focus: null,
      target: { layerId: null, dataId: null, label: "Tooltip" },
      overlay: null,
      properties: {
        before: clone(before),
        after: clone(after),
        beforeLabel: `${before.enabled === false ? "Desativado" : "Ativo"} · ${beforeDatasets} dataset(s)`,
        afterLabel: `${after.enabled === false ? "Desativado" : "Ativo"} · ${afterDatasets} dataset(s)`,
      },
    };
  }

  const before = record(payload.before) || {};
  const after = record(payload.after) || {};
  return {
    ...baseProjection(operation),
    type: "map.blending.update",
    label: "Composição visual",
    focus: null,
    target: { layerId: null, dataId: null, label: "Composição visual" },
    overlay: null,
    properties: {
      before: clone(before),
      after: clone(after),
      beforeLabel: `Camadas: ${text(before.layers) || "normal"} · Overlays: ${text(before.overlays) || "normal"}`,
      afterLabel: `Camadas: ${text(after.layers) || "normal"} · Overlays: ${text(after.overlays) || "normal"}`,
    },
  };
}

export function buildReviewOperationProjections(
  baseConfig: unknown,
  operations: ReviewSourceOperation[],
): ReviewOperationProjection[] {
  const ordered = [...operations].sort(
    (left, right) => Number(left.sequence ?? 0) - Number(right.sequence ?? 0),
  );
  const coreOperations = ordered.filter(
    (operation) => !COVERAGE_TYPES.has(operation.type),
  );
  const core = buildCoreReviewOperationProjections(baseConfig, coreOperations);
  const coreById = new Map(core.map((projection) => [projection.id, projection]));

  // New coverage operations intentionally project only their bounded semantic
  // payload. The existing projector keeps the lightweight virtual-layer model
  // for lifecycle/style/filters. No MapConfig clone is introduced here.
  return ordered.map((operation) =>
    COVERAGE_TYPES.has(operation.type)
      ? projectCoverageOperation(operation)
      : (coreById.get(operation.id) as ReviewOperationProjection),
  );
}

export function materializeProjectChangeReviewProjections(
  review: ProjectChangeReview,
  baseConfig: unknown,
) {
  return buildReviewOperationProjections(baseConfig, review.operations);
}
