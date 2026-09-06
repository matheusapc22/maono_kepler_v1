export * from "./viewer-layer-lifecycle-core.ts";

import {
  compactViewerOperationsForLocalLayerRemoval as compactCoreOperations,
  viewerLifecycleCreatedLayerId,
  viewerLifecycleTargetLayerId as coreTargetLayerId,
} from "./viewer-layer-lifecycle-core.ts";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function viewerLifecycleTargetLayerId(
  operation: { type?: unknown; payload?: unknown },
) {
  if (operation.type === "layer.definition.update") {
    return text(record(operation.payload)?.targetLayerId) || null;
  }
  return coreTargetLayerId(operation);
}

export function compactViewerOperationsForLocalLayerRemoval<
  T extends { type: string; payload: unknown },
>(operations: T[], layerId: string): T[] {
  const normalizedLayerId = text(layerId);
  if (!normalizedLayerId) return [...operations];
  const bornLocally = operations.some(
    (operation) => viewerLifecycleCreatedLayerId(operation) === normalizedLayerId,
  );
  const compacted = compactCoreOperations(operations, normalizedLayerId);
  if (!bornLocally) return compacted;

  // PR persistent-mutation-coverage adds definition changes that target a
  // layer but do not belong to the original lifecycle registry. When a local
  // create/duplicate is removed before submission, these dependent mutations
  // must disappear with it or the proposal would retain a dangling target.
  return compacted.filter(
    (operation) =>
      !(
        operation.type === "layer.definition.update" &&
        text(record(operation.payload)?.targetLayerId) === normalizedLayerId
      ),
  );
}
