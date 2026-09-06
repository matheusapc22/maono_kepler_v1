import { useEffect, useRef } from "react";

import { useKeplerEngineAdapter } from "../engine-adapter";
import {
  MAONO_VIEWER_MUTATION_EVENT,
  viewerMutationEventDetail,
} from "./viewer-mutation-policy.ts";
import {
  applyViewerLayerDefinition,
  snapshotViewerLayerDefinition,
  snapshotViewerMapBlending,
  snapshotViewerTooltip,
  viewerJsonEqual,
  type ViewerLayerDefinitionSnapshot,
  type ViewerLayerDefinitionUpdatePayload,
  type ViewerMapBlendingSnapshot,
  type ViewerMapBlendingUpdatePayload,
  type ViewerTooltipConfigUpdatePayload,
  type ViewerTooltipSnapshot,
} from "./viewer-persistent-mutations.ts";
import {
  isWorkingCopyWriteCancelled,
  type ViewerChangeOperation,
  ViewerWorkingCopyStore,
  type ViewerWorkingCopy,
} from "./viewer-working-copy.ts";

type Props = {
  enabled: boolean;
  store: ViewerWorkingCopyStore | null;
  workingCopy: ViewerWorkingCopy | null;
  baseRevision: number;
  onWorkingCopyChange(value: ViewerWorkingCopy | null): void;
};

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

function definitionPayload(
  operation: ViewerChangeOperation,
): ViewerLayerDefinitionUpdatePayload | null {
  return operation.type === "layer.definition.update"
    ? (record(operation.payload) as ViewerLayerDefinitionUpdatePayload | null)
    : null;
}

function tooltipPayload(
  operation: ViewerChangeOperation,
): ViewerTooltipConfigUpdatePayload | null {
  return operation.type === "tooltip.config.update"
    ? (record(operation.payload) as ViewerTooltipConfigUpdatePayload | null)
    : null;
}

function blendingPayload(
  operation: ViewerChangeOperation,
): ViewerMapBlendingUpdatePayload | null {
  return operation.type === "map.blending.update"
    ? (record(operation.payload) as ViewerMapBlendingUpdatePayload | null)
    : null;
}

function locallyCreatedLayerIds(workingCopy: ViewerWorkingCopy | null) {
  const ids = new Set<string>();
  for (const operation of workingCopy?.operations || []) {
    const payload = record(operation.payload);
    if (operation.type === "layer.create" || operation.type === "layer.duplicate") {
      const layer = record(payload?.layer);
      const id = text(layer?.id);
      if (id) ids.add(id);
    }
    if (
      (operation.type === "point.create" ||
        operation.type === "buffer.create" ||
        operation.type === "isochrone.create") &&
      text(payload?.targetLayerId)
    ) {
      ids.add(text(payload?.targetLayerId));
    }
  }
  return ids;
}

function tooltipWithoutTransient(
  snapshot: ViewerTooltipSnapshot,
  transientDatasetIds: string[],
): ViewerTooltipSnapshot {
  const transient = new Set(transientDatasetIds);
  return {
    enabled: snapshot.enabled,
    fieldsByDataset: Object.fromEntries(
      Object.entries(snapshot.fieldsByDataset).filter(
        ([dataId]) => !transient.has(dataId),
      ),
    ),
  };
}

function operationFor(
  existing: ViewerChangeOperation | null,
  type: string,
  payload: unknown,
): ViewerChangeOperation {
  return {
    id: existing?.id || `op_${crypto.randomUUID()}`,
    type,
    version: 1,
    payload: clone(payload),
    createdAt: existing?.createdAt || new Date().toISOString(),
  };
}

async function rewriteOperations(
  store: ViewerWorkingCopyStore,
  baseRevision: number,
  transform: (operations: ViewerChangeOperation[]) => ViewerChangeOperation[],
) {
  const current = await store.ensure(baseRevision);
  const desired = transform(current.operations.map(clone));
  let firstDifference = 0;
  const sharedLength = Math.min(current.operations.length, desired.length);
  while (
    firstDifference < sharedLength &&
    viewerJsonEqual(current.operations[firstDifference], desired[firstDifference])
  ) {
    firstDifference += 1;
  }
  if (
    firstDifference === current.operations.length &&
    firstDifference === desired.length
  ) {
    return current;
  }

  let next: ViewerWorkingCopy | null = current;
  for (let index = current.operations.length - 1; index >= firstDifference; index -= 1) {
    next = await store.removeOperation(current.operations[index].id);
  }
  for (let index = firstDifference; index < desired.length; index += 1) {
    next = await store.appendOperation(baseRevision, desired[index]);
  }
  return next;
}

async function upsertOperation(
  store: ViewerWorkingCopyStore,
  baseRevision: number,
  predicate: (operation: ViewerChangeOperation) => boolean,
  type: string,
  payload: unknown,
  remove: boolean,
) {
  return rewriteOperations(store, baseRevision, (operations) => {
    const index = operations.findIndex(predicate);
    const existing = index >= 0 ? operations[index] : null;
    if (remove) {
      if (index >= 0) operations.splice(index, 1);
      return operations;
    }
    const operation = operationFor(existing, type, payload);
    if (index >= 0) operations[index] = operation;
    else operations.push(operation);
    return operations;
  });
}

export default function ViewerPersistentMutationRuntime({
  enabled,
  store,
  workingCopy,
  baseRevision,
  onWorkingCopyChange,
}: Props) {
  const { commands, markClean, state } = useKeplerEngineAdapter();
  const runtimeKey = `${store?.key || "none"}:${baseRevision}`;
  const baseKeyRef = useRef("");
  const baseDefinitionsRef = useRef(
    new Map<string, ViewerLayerDefinitionSnapshot>(),
  );
  const baseTooltipRef = useRef<ViewerTooltipSnapshot | null>(null);
  const baseBlendingRef = useRef<ViewerMapBlendingSnapshot | null>(null);
  const captureBusyRef = useRef(false);
  const replayingRef = useRef(false);
  const appliedOperationIdsRef = useRef(new Set<string>());
  const sessionMutationPendingRef = useRef(false);
  const persistentAckUpdatedAtRef = useRef<string | null>(null);
  const lastWorkingCopyUpdatedAtRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || !store || !state.ready || baseKeyRef.current === runtimeKey) {
      return;
    }
    baseKeyRef.current = runtimeKey;
    baseDefinitionsRef.current = new Map(
      state.layers.flatMap((layer) => {
        if (layer.dataIds.some((id) => state.transientDatasetIds.includes(id))) {
          return [];
        }
        const snapshot = snapshotViewerLayerDefinition(layer);
        return snapshot ? [[layer.id, snapshot] as const] : [];
      }),
    );
    baseTooltipRef.current = tooltipWithoutTransient(
      snapshotViewerTooltip(state),
      state.transientDatasetIds,
    );
    baseBlendingRef.current = snapshotViewerMapBlending(state);
    captureBusyRef.current = false;
    replayingRef.current = false;
    appliedOperationIdsRef.current.clear();
    sessionMutationPendingRef.current = false;
    persistentAckUpdatedAtRef.current = null;
    lastWorkingCopyUpdatedAtRef.current = workingCopy?.updatedAt || null;
  }, [
    enabled,
    runtimeKey,
    state.layers,
    state.ready,
    state.transientDatasetIds,
    store,
    workingCopy?.updatedAt,
  ]);

  useEffect(() => {
    if (!enabled || !store || !store.writable) return undefined;
    const handleMutation = (event: Event) => {
      if (replayingRef.current) return;
      const detail = viewerMutationEventDetail(event);
      if (!detail || !detail.changed) return;
      if (detail.kind === "session") {
        sessionMutationPendingRef.current = true;
        return;
      }
      if (detail.kind === "persistent") {
        persistentAckUpdatedAtRef.current = workingCopy?.updatedAt || null;
      }
    };
    window.addEventListener(MAONO_VIEWER_MUTATION_EVENT, handleMutation);
    return () => {
      window.removeEventListener(MAONO_VIEWER_MUTATION_EVENT, handleMutation);
    };
  }, [enabled, store, workingCopy?.updatedAt]);

  useEffect(() => {
    if (
      !enabled ||
      !store ||
      !store.writable ||
      !workingCopy ||
      !state.ready ||
      baseKeyRef.current !== runtimeKey
    ) {
      return;
    }

    let projected = false;
    replayingRef.current = true;
    try {
      for (const operation of workingCopy.operations) {
        if (appliedOperationIdsRef.current.has(operation.id)) continue;

        const definition = definitionPayload(operation);
        if (definition) {
          baseDefinitionsRef.current.set(
            definition.targetLayerId,
            clone(definition.before),
          );
          const result = applyViewerLayerDefinition(
            commands,
            definition.targetLayerId,
            definition.after,
          );
          projected = projected || result.changed;
          if (!result.ok) {
            console.warn("Viewer Working Copy definition replay failed", {
              operationId: operation.id,
              error: result.error,
            });
          }
          appliedOperationIdsRef.current.add(operation.id);
          continue;
        }

        const tooltip = tooltipPayload(operation);
        if (tooltip) {
          baseTooltipRef.current = clone(tooltip.before);
          const fields = Object.fromEntries(
            Object.entries(tooltip.after.fieldsByDataset).map(([dataId, values]) => [
              dataId,
              values.map((field) => field.name),
            ]),
          );
          const fieldResult = commands.setTooltipFields(fields);
          const enabledResult = commands.setTooltipEnabled(tooltip.after.enabled);
          projected =
            projected ||
            (fieldResult.ok && fieldResult.changed) ||
            (enabledResult.ok && enabledResult.changed);
          appliedOperationIdsRef.current.add(operation.id);
          continue;
        }

        const blending = blendingPayload(operation);
        if (blending) {
          baseBlendingRef.current = clone(blending.before);
          const layers = commands.setLayerBlending(blending.after.layers);
          const overlays = commands.setOverlayBlending(blending.after.overlays);
          projected =
            projected ||
            (layers.ok && layers.changed) ||
            (overlays.ok && overlays.changed);
          appliedOperationIdsRef.current.add(operation.id);
        }
      }
    } finally {
      replayingRef.current = false;
    }

    if (projected) {
      persistentAckUpdatedAtRef.current = workingCopy.updatedAt;
    }
  }, [
    commands,
    enabled,
    runtimeKey,
    state.ready,
    store,
    workingCopy,
  ]);

  useEffect(() => {
    if (
      !enabled ||
      !store ||
      !store.writable ||
      !state.ready ||
      baseKeyRef.current !== runtimeKey ||
      captureBusyRef.current ||
      replayingRef.current
    ) {
      return;
    }

    const localIds = locallyCreatedLayerIds(workingCopy);
    const pendingDefinitions = state.layers.flatMap((layer) => {
      if (layer.dataIds.some((id) => state.transientDatasetIds.includes(id))) {
        return [];
      }
      const after = snapshotViewerLayerDefinition(layer);
      if (!after) return [];
      const existing = workingCopy?.operations.find((operation) => {
        const payload = definitionPayload(operation);
        return payload?.targetLayerId === layer.id;
      }) || null;
      const existingPayload = existing ? definitionPayload(existing) : null;
      let before = existingPayload?.before || baseDefinitionsRef.current.get(layer.id) || null;
      if (!before && localIds.has(layer.id)) {
        baseDefinitionsRef.current.set(layer.id, clone(after));
        before = after;
      }
      if (!before) return [];
      const remove = viewerJsonEqual(before, after);
      if (remove && !existing) return [];
      if (existingPayload && viewerJsonEqual(existingPayload.after, after)) return [];
      return [{ layerId: layer.id, before, after, existing, remove }];
    });

    const currentTooltip = tooltipWithoutTransient(
      snapshotViewerTooltip(state),
      state.transientDatasetIds,
    );
    const existingTooltip =
      workingCopy?.operations.find(
        (operation) => operation.type === "tooltip.config.update",
      ) || null;
    const existingTooltipPayload = existingTooltip
      ? tooltipPayload(existingTooltip)
      : null;
    const tooltipBefore =
      existingTooltipPayload?.before || baseTooltipRef.current || currentTooltip;
    const tooltipChanged = !viewerJsonEqual(tooltipBefore, currentTooltip);
    const pendingTooltip = tooltipChanged
      ? !existingTooltipPayload ||
        !viewerJsonEqual(existingTooltipPayload.after, currentTooltip)
      : Boolean(existingTooltip);

    const currentBlending = snapshotViewerMapBlending(state);
    const existingBlending =
      workingCopy?.operations.find(
        (operation) => operation.type === "map.blending.update",
      ) || null;
    const existingBlendingPayload = existingBlending
      ? blendingPayload(existingBlending)
      : null;
    const blendingBefore =
      existingBlendingPayload?.before || baseBlendingRef.current || currentBlending;
    const blendingChanged = !viewerJsonEqual(blendingBefore, currentBlending);
    const pendingBlending = blendingChanged
      ? !existingBlendingPayload ||
        !viewerJsonEqual(existingBlendingPayload.after, currentBlending)
      : Boolean(existingBlending);

    if (
      !pendingDefinitions.length &&
      !pendingTooltip &&
      !pendingBlending
    ) {
      if (state.hasUnsavedChanges && sessionMutationPendingRef.current) {
        sessionMutationPendingRef.current = false;
        markClean();
      }
      return;
    }

    captureBusyRef.current = true;
    void (async () => {
      let next = workingCopy;
      try {
        for (const item of pendingDefinitions) {
          if (!store.writable) return;
          next = await upsertOperation(
            store,
            baseRevision,
            (operation) => {
              const payload = definitionPayload(operation);
              return payload?.targetLayerId === item.layerId;
            },
            "layer.definition.update",
            {
              targetLayerId: item.layerId,
              before: item.before,
              after: item.after,
            } satisfies ViewerLayerDefinitionUpdatePayload,
            item.remove,
          );
        }

        if (pendingTooltip && store.writable) {
          next = await upsertOperation(
            store,
            baseRevision,
            (operation) => operation.type === "tooltip.config.update",
            "tooltip.config.update",
            {
              before: tooltipBefore,
              after: currentTooltip,
            } satisfies ViewerTooltipConfigUpdatePayload,
            !tooltipChanged,
          );
        }

        if (pendingBlending && store.writable) {
          next = await upsertOperation(
            store,
            baseRevision,
            (operation) => operation.type === "map.blending.update",
            "map.blending.update",
            {
              before: blendingBefore,
              after: currentBlending,
            } satisfies ViewerMapBlendingUpdatePayload,
            !blendingChanged,
          );
        }

        if (!store.writable) return;
        onWorkingCopyChange(next);
        sessionMutationPendingRef.current = false;
        persistentAckUpdatedAtRef.current = next?.updatedAt || null;
        markClean();
      } catch (error) {
        if (!isWorkingCopyWriteCancelled(error)) {
          console.warn("Viewer persistent mutation capture failed", { error });
        }
      } finally {
        captureBusyRef.current = false;
      }
    })();
  }, [
    baseRevision,
    enabled,
    markClean,
    onWorkingCopyChange,
    runtimeKey,
    state.basemap.blending.layers,
    state.basemap.blending.overlays,
    state.hasUnsavedChanges,
    state.interaction.tooltip.enabled,
    state.interaction.tooltip.fieldsByDataset,
    state.layers,
    state.ready,
    state.transientDatasetIds,
    store,
    workingCopy,
  ]);

  useEffect(() => {
    if (!enabled) return;
    const previous = lastWorkingCopyUpdatedAtRef.current;
    const current = workingCopy?.updatedAt || null;
    lastWorkingCopyUpdatedAtRef.current = current;
    if (
      state.hasUnsavedChanges &&
      persistentAckUpdatedAtRef.current !== null &&
      current !== previous
    ) {
      persistentAckUpdatedAtRef.current = null;
      markClean();
    }
  }, [enabled, markClean, state.hasUnsavedChanges, workingCopy?.updatedAt]);

  return null;
}
