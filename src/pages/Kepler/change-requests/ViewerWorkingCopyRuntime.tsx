import { useEffect, useMemo, useRef, useState } from "react";

import { useKeplerEngineAdapter } from "../engine-adapter";
import type { MapLayerSummary } from "../engine-adapter/types";
import {
  type PointDatasetTarget,
  usePointDatasetCommand,
} from "../engine-adapter/usePointDatasetCommand";
import { useViewerLayerLifecycleReplayCommand } from "../engine-adapter/useViewerLayerLifecycleReplayCommand";
import {
  applyViewerLayerStyleChanges,
  diffViewerLayerStyle,
  hasViewerLayerStyleChanges,
  snapshotViewerLayerStyle,
  viewerLayerStyleChangesEqual,
  type ViewerLayerStyleSnapshot,
} from "./viewer-layer-style";
import {
  isViewerAnalysisOperationEvent,
  MAONO_VIEWER_ANALYSIS_OPERATION_EVENT,
} from "./viewer-analysis-operation";
import {
  compactViewerOperationsForLocalLayerRemoval,
  inferViewerDuplicateSource,
  snapshotViewerLifecycleLayer,
  viewerLifecycleCreatedLayerId,
  type ViewerLayerCreatePayload,
  type ViewerLayerDuplicatePayload,
  type ViewerLayerRemovePayload,
  type ViewerLayerSnapshot,
} from "./viewer-layer-lifecycle";
import {
  snapshotViewerPersistentFilter,
  viewerJsonEqual,
  type ViewerLayerOrderUpdatePayload,
  type ViewerLayerVisibilityUpdatePayload,
  type ViewerPersistentFilterSnapshot,
  type ViewerPersistentFilterUpdatePayload,
} from "./viewer-persistent-visualization";
import {
  isWorkingCopyWriteCancelled,
  ViewerWorkingCopyStore,
  type ViewerAnalysisCreatePayload,
  type ViewerChangeOperation,
  type ViewerLayerStyleUpdatePayload,
  type ViewerWorkingCopy,
} from "./viewer-working-copy";

type Props = {
  enabled: boolean;
  store: ViewerWorkingCopyStore | null;
  workingCopy: ViewerWorkingCopy | null;
  baseRevision: number;
  onWorkingCopyChange(value: ViewerWorkingCopy | null): void;
};

type PointPayload = {
  tempId?: string;
  latitude?: number;
  longitude?: number;
  targetLayerId?: string | null;
  targetDataId?: string | null;
  targetLabel?: string;
  targetMode?: string;
  fieldMap?: PointDatasetTarget["fieldMap"];
  properties?: {
    name?: string;
    type?: string;
    description?: string;
  };
};

type LifecycleCommand =
  | "createLayerFromDataset"
  | "duplicateLayer"
  | "removeLayer";

function asRecord(value: unknown): Record<string, unknown> | null {
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

function pointPayload(operation: ViewerChangeOperation): PointPayload | null {
  return operation.type === "point.create"
    ? (asRecord(operation.payload) as PointPayload | null)
    : null;
}

function stylePayload(
  operation: ViewerChangeOperation,
): ViewerLayerStyleUpdatePayload | null {
  return operation.type === "layer.style.update"
    ? (asRecord(operation.payload) as ViewerLayerStyleUpdatePayload | null)
    : null;
}

function analysisPayload(
  operation: ViewerChangeOperation,
): ViewerAnalysisCreatePayload | null {
  return operation.type === "buffer.create" || operation.type === "isochrone.create"
    ? (asRecord(operation.payload) as ViewerAnalysisCreatePayload | null)
    : null;
}

function visibilityPayload(
  operation: ViewerChangeOperation,
): ViewerLayerVisibilityUpdatePayload | null {
  return operation.type === "layer.visibility.update"
    ? (asRecord(operation.payload) as ViewerLayerVisibilityUpdatePayload | null)
    : null;
}

function filterPayload(
  operation: ViewerChangeOperation,
): ViewerPersistentFilterUpdatePayload | null {
  return operation.type === "persistent.filter.update"
    ? (asRecord(operation.payload) as ViewerPersistentFilterUpdatePayload | null)
    : null;
}

function orderPayload(
  operation: ViewerChangeOperation,
): ViewerLayerOrderUpdatePayload | null {
  return operation.type === "layer.order.update"
    ? (asRecord(operation.payload) as ViewerLayerOrderUpdatePayload | null)
    : null;
}

function layerCreatePayload(
  operation: ViewerChangeOperation,
): ViewerLayerCreatePayload | null {
  return operation.type === "layer.create"
    ? (asRecord(operation.payload) as ViewerLayerCreatePayload | null)
    : null;
}

function layerDuplicatePayload(
  operation: ViewerChangeOperation,
): ViewerLayerDuplicatePayload | null {
  return operation.type === "layer.duplicate"
    ? (asRecord(operation.payload) as ViewerLayerDuplicatePayload | null)
    : null;
}

function layerRemovePayload(
  operation: ViewerChangeOperation,
): ViewerLayerRemovePayload | null {
  return operation.type === "layer.remove"
    ? (asRecord(operation.payload) as ViewerLayerRemovePayload | null)
    : null;
}

function existingStyleOperation(
  workingCopy: ViewerWorkingCopy | null,
  layerId: string,
) {
  return (
    workingCopy?.operations.find((operation) => {
      const payload = stylePayload(operation);
      return payload && text(payload.targetLayerId) === layerId;
    }) || null
  );
}

function existingVisibilityOperation(
  workingCopy: ViewerWorkingCopy | null,
  layerId: string,
) {
  return (
    workingCopy?.operations.find((operation) => {
      const payload = visibilityPayload(operation);
      return payload && text(payload.targetLayerId) === layerId;
    }) || null
  );
}

function existingFilterOperation(
  workingCopy: ViewerWorkingCopy | null,
  filterId: string,
) {
  return (
    workingCopy?.operations.find((operation) => {
      const payload = filterPayload(operation);
      return payload && text(payload.filterId) === filterId;
    }) || null
  );
}

function existingOrderOperation(workingCopy: ViewerWorkingCopy | null) {
  return workingCopy?.operations.find((operation) => operation.type === "layer.order.update") || null;
}

function locallyCreatedLayerIds(workingCopy: ViewerWorkingCopy | null) {
  const ids = new Set<string>();
  for (const operation of workingCopy?.operations || []) {
    const point = pointPayload(operation);
    if (point && text(point.targetMode).toLowerCase() === "new" && text(point.targetLayerId)) {
      ids.add(text(point.targetLayerId));
    }
    const analysis = analysisPayload(operation);
    if (analysis && text(analysis.targetLayerId)) ids.add(text(analysis.targetLayerId));
    const lifecycleId = viewerLifecycleCreatedLayerId(operation);
    if (lifecycleId) ids.add(lifecycleId);
  }
  return ids;
}

function lifecycleStyleSnapshot(snapshot: ViewerLayerSnapshot): ViewerLayerStyleSnapshot {
  return {
    color: [...snapshot.style.color] as [number, number, number],
    opacity: snapshot.style.opacity,
    fillEnabled: snapshot.style.fillEnabled,
    strokeEnabled: snapshot.style.strokeEnabled,
    strokeColor: [...snapshot.style.strokeColor] as [number, number, number],
    strokeOpacity: snapshot.style.strokeOpacity,
    strokeWidth: snapshot.style.strokeWidth,
    pointRadius: snapshot.style.pointRadius,
    clusterRadius: snapshot.style.clusterRadius,
    heatmapRadius: snapshot.style.heatmapRadius,
  };
}

function insertLayerId(order: string[], layerId: string, insertIndex: number) {
  const next = order.filter((id) => id !== layerId);
  const index = Math.max(0, Math.min(Number(insertIndex), next.length));
  next.splice(index, 0, layerId);
  return next;
}

function cloneLayerMap(layers: MapLayerSummary[]) {
  return new Map(layers.map((layer) => [layer.id, clone(layer)]));
}

async function replaceViewerOperation(
  store: ViewerWorkingCopyStore,
  baseRevision: number,
  existing: ViewerChangeOperation | null,
  type: string,
  payload: unknown,
  remove: boolean,
) {
  if (existing) await store.removeOperation(existing.id);
  if (remove) return store.load();
  return store.appendOperation(baseRevision, {
    id: existing?.id || `op_${crypto.randomUUID()}`,
    type,
    version: 1,
    payload,
    createdAt: existing?.createdAt || new Date().toISOString(),
  });
}

async function persistCompactedOperations(
  store: ViewerWorkingCopyStore,
  baseRevision: number,
  current: ViewerWorkingCopy,
  compacted: ViewerChangeOperation[],
) {
  let firstDifference = 0;
  const sharedLength = Math.min(current.operations.length, compacted.length);
  while (
    firstDifference < sharedLength &&
    JSON.stringify(current.operations[firstDifference]) ===
      JSON.stringify(compacted[firstDifference])
  ) {
    firstDifference += 1;
  }
  if (
    firstDifference === current.operations.length &&
    firstDifference === compacted.length
  ) {
    return current;
  }

  let next: ViewerWorkingCopy | null = current;
  for (let index = current.operations.length - 1; index >= firstDifference; index -= 1) {
    next = await store.removeOperation(current.operations[index].id);
  }
  for (let index = firstDifference; index < compacted.length; index += 1) {
    next = await store.appendOperation(baseRevision, compacted[index]);
  }
  return next;
}

export default function ViewerWorkingCopyRuntime({
  enabled,
  store,
  workingCopy,
  baseRevision,
  onWorkingCopyChange,
}: Props) {
  const { commands, markClean, state } = useKeplerEngineAdapter();
  const createDatasetPoint = usePointDatasetCommand();
  const lifecycleReplay = useViewerLayerLifecycleReplayCommand();
  const [lifecycleSignal, setLifecycleSignal] = useState(0);
  const runtimeKey = `${store?.key || "none"}:${baseRevision}`;
  const baseKeyRef = useRef("");
  const baseStylesRef = useRef(new Map<string, ViewerLayerStyleSnapshot>());
  const baseVisibilityRef = useRef(new Map<string, boolean>());
  const baseFiltersRef = useRef(new Map<string, ViewerPersistentFilterSnapshot>());
  const baseOrderRef = useRef<string[]>([]);
  const lastLayerStateRef = useRef(new Map<string, MapLayerSummary>());
  const pendingLifecycleBeforeRef = useRef(new Map<string, MapLayerSummary>());
  const pendingLifecycleCommandRef = useRef<LifecycleCommand | null>(null);
  const filterIndexAliasRef = useRef(new Map<number, string>());
  const filterRuntimeAliasRef = useRef(new Map<string, string>());
  const captureBusyRef = useRef(false);
  const lifecycleCaptureBusyRef = useRef(false);
  const pendingProjectionAckRef = useRef(false);
  const untrackedLatchedRef = useRef(false);
  const applyingOperationIdsRef = useRef(new Set<string>());
  const appliedOperationIdsRef = useRef(new Set<string>());

  const baseLayerMeta = useMemo(() => {
    const result = new Map<string, { dataId: string | null; label: string }>();
    for (const layer of state.layers) {
      if (layer.id.startsWith("tmp_layer_")) continue;
      result.set(layer.id, {
        dataId: layer.dataIds[0] || null,
        label: layer.label,
      });
    }
    return result;
  }, [state.layers]);

  useEffect(() => {
    if (!enabled || !store || !store.writable) return undefined;

    const handleAnalysisOperation = (event: Event) => {
      if (!isViewerAnalysisOperationEvent(event)) return;
      const { request, respond } = event.detail;
      if (!store.writable) {
        respond({
          ok: false,
          message: "As alterações locais estão sendo descartadas.",
        });
        return;
      }
      const operation: ViewerChangeOperation = {
        id: `op_${crypto.randomUUID()}`,
        type: request.type,
        version: 1,
        payload: request.payload,
        createdAt: new Date().toISOString(),
      };

      void store
        .appendOperation(baseRevision, operation)
        .then((next) => {
          if (!store.writable) {
            respond({
              ok: false,
              message: "As alterações locais estão sendo descartadas.",
            });
            return;
          }
          onWorkingCopyChange(next);
          untrackedLatchedRef.current = false;
          pendingProjectionAckRef.current = false;
          markClean();
          respond({ ok: true, operation });
        })
        .catch((error) => {
          respond({
            ok: false,
            message: isWorkingCopyWriteCancelled(error)
              ? "As alterações locais estão sendo descartadas."
              : (error as { code?: string })?.code === "WORKING_COPY_BASE_REVISION_STALE"
                ? "O projeto mudou desde o início destas alterações locais."
                : "Não foi possível guardar a análise no workspace local.",
          });
        });
    };

    window.addEventListener(
      MAONO_VIEWER_ANALYSIS_OPERATION_EVENT,
      handleAnalysisOperation,
    );
    return () => {
      window.removeEventListener(
        MAONO_VIEWER_ANALYSIS_OPERATION_EVENT,
        handleAnalysisOperation,
      );
    };
  }, [baseRevision, enabled, markClean, onWorkingCopyChange, store]);

  useEffect(() => {
    if (!enabled || !store || !store.writable) return undefined;
    const handleTelemetry = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (detail?.event !== "map_panel_command_executed") return;
      const command = String(detail.command || "") as LifecycleCommand;
      if (
        command !== "createLayerFromDataset" &&
        command !== "duplicateLayer" &&
        command !== "removeLayer"
      ) {
        return;
      }
      pendingLifecycleBeforeRef.current = new Map(lastLayerStateRef.current);
      pendingLifecycleCommandRef.current = command;
      setLifecycleSignal((current) => current + 1);
    };
    window.addEventListener("maono:map-panel-telemetry", handleTelemetry);
    return () => {
      window.removeEventListener("maono:map-panel-telemetry", handleTelemetry);
    };
  }, [enabled, store]);

  useEffect(() => {
    if (
      !enabled ||
      !store ||
      !store.writable ||
      !state.ready ||
      baseKeyRef.current === runtimeKey
    ) {
      return;
    }

    baseKeyRef.current = runtimeKey;
    baseStylesRef.current = new Map(
      state.layers
        .filter((layer) => !layer.id.startsWith("tmp_layer_"))
        .map((layer) => [layer.id, snapshotViewerLayerStyle(layer.style)]),
    );
    baseVisibilityRef.current = new Map(
      state.layers
        .filter((layer) => !layer.id.startsWith("tmp_layer_"))
        .map((layer) => [layer.id, layer.isVisible]),
    );
    baseFiltersRef.current = new Map(
      state.filters.flatMap((filter) => {
        const snapshot = snapshotViewerPersistentFilter(filter);
        return snapshot ? [[snapshot.id, snapshot] as const] : [];
      }),
    );
    baseOrderRef.current = state.layers.map((layer) => layer.id);
    lastLayerStateRef.current = cloneLayerMap(state.layers);
    pendingLifecycleBeforeRef.current.clear();
    pendingLifecycleCommandRef.current = null;
    filterIndexAliasRef.current.clear();
    filterRuntimeAliasRef.current.clear();
    captureBusyRef.current = false;
    lifecycleCaptureBusyRef.current = false;
    pendingProjectionAckRef.current = false;
    untrackedLatchedRef.current = false;
    applyingOperationIdsRef.current.clear();
    appliedOperationIdsRef.current.clear();
  }, [enabled, runtimeKey, state.filters, state.layers, state.ready, store]);

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

    const knownDataIds = new Set(state.datasets.map((dataset) => dataset.id));
    let projectedMutation = false;

    for (const operation of workingCopy.operations) {
      if (
        applyingOperationIdsRef.current.has(operation.id) ||
        appliedOperationIdsRef.current.has(operation.id)
      ) {
        continue;
      }

      applyingOperationIdsRef.current.add(operation.id);
      try {
        const createdLayer = layerCreatePayload(operation);
        if (createdLayer) {
          const result = lifecycleReplay.restore(
            createdLayer.layer,
            createdLayer.insertIndex,
          );
          projectedMutation = projectedMutation || (result.ok && result.changed);
          if (result.ok) {
            baseOrderRef.current = insertLayerId(
              baseOrderRef.current,
              createdLayer.layer.id,
              createdLayer.insertIndex,
            );
            baseStylesRef.current.set(
              createdLayer.layer.id,
              lifecycleStyleSnapshot(createdLayer.layer),
            );
            baseVisibilityRef.current.set(
              createdLayer.layer.id,
              createdLayer.layer.isVisible,
            );
          } else {
            console.warn("Viewer Working Copy replay could not restore a created layer", {
              operationId: operation.id,
              reason: result.reason,
            });
          }
          continue;
        }

        const duplicatedLayer = layerDuplicatePayload(operation);
        if (duplicatedLayer) {
          const result = lifecycleReplay.restore(
            duplicatedLayer.layer,
            duplicatedLayer.insertIndex,
          );
          projectedMutation = projectedMutation || (result.ok && result.changed);
          if (result.ok) {
            baseOrderRef.current = insertLayerId(
              baseOrderRef.current,
              duplicatedLayer.layer.id,
              duplicatedLayer.insertIndex,
            );
            baseStylesRef.current.set(
              duplicatedLayer.layer.id,
              lifecycleStyleSnapshot(duplicatedLayer.layer),
            );
            baseVisibilityRef.current.set(
              duplicatedLayer.layer.id,
              duplicatedLayer.layer.isVisible,
            );
          } else {
            console.warn("Viewer Working Copy replay could not restore a duplicated layer", {
              operationId: operation.id,
              reason: result.reason,
            });
          }
          continue;
        }

        const removedLayer = layerRemovePayload(operation);
        if (removedLayer) {
          const result = lifecycleReplay.remove(removedLayer.targetLayerId);
          projectedMutation = projectedMutation || (result.ok && result.changed);
          if (result.ok) {
            baseOrderRef.current = baseOrderRef.current.filter(
              (id) => id !== removedLayer.targetLayerId,
            );
          } else {
            console.warn("Viewer Working Copy replay could not remove a layer", {
              operationId: operation.id,
              reason: result.reason,
            });
          }
          continue;
        }

        const point = pointPayload(operation);
        if (point && text(point.targetMode).toLowerCase() === "new") {
          const dataId = text(point.targetDataId);
          const layerId = text(point.targetLayerId);
          const latitude = Number(point.latitude);
          const longitude = Number(point.longitude);
          const fieldMap = point.fieldMap;
          if (
            !dataId ||
            !layerId ||
            !fieldMap ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude)
          ) {
            continue;
          }

          const result = createDatasetPoint({
            target: {
              dataId,
              layerId,
              label: text(point.targetLabel) || "Pontos adicionados",
              fieldMap,
              createNew: !knownDataIds.has(dataId),
            },
            latitude,
            longitude,
            tempId: text(point.tempId),
            properties: {
              name: text(point.properties?.name) || "Novo ponto",
              type: text(point.properties?.type),
              description: text(point.properties?.description),
            },
          });
          if (result.ok) {
            knownDataIds.add(dataId);
            projectedMutation = projectedMutation || result.changed;
          } else {
            console.warn("Viewer Working Copy replay could not project a point", {
              operationId: operation.id,
              code: result.code,
              reason: result.reason,
            });
          }
          continue;
        }

        const analysis = analysisPayload(operation);
        if (analysis) {
          const dataId = text(analysis.targetDataId);
          if (!dataId || knownDataIds.has(dataId)) continue;
          const isBuffer = operation.type === "buffer.create";
          const result = commands.addGeoJsonLayer({
            dataId,
            label: text(analysis.targetLabel) || (isBuffer ? "Buffer" : "Isócrona"),
            geoJson: analysis.geojson,
            color: [197, 160, 89],
            strokeColor: [183, 121, 31],
            opacity: isBuffer ? 0.2 : 0.28,
            transient: true,
            analysisKind: isBuffer ? "buffer" : "isochrone",
            presentation: isBuffer
              ? {
                  tooltipFields: [
                    "analysis_label",
                    "radius_label",
                    "origin_latitude",
                    "origin_longitude",
                    "maono_buffer_item_id",
                  ],
                  legendField: "radius_label",
                  legendPalette: ["#FFF8E7", "#F1D28A", "#D69E2E", "#B7791F"],
                }
              : undefined,
            centerMap: false,
          });
          if (result.ok) {
            knownDataIds.add(dataId);
            projectedMutation = projectedMutation || result.changed;
          } else {
            console.warn("Viewer Working Copy replay could not project an analysis", {
              operationId: operation.id,
              operationType: operation.type,
              code: result.code,
              reason: result.reason,
            });
          }
          continue;
        }

        const style = stylePayload(operation);
        if (style && text(style.targetLayerId)) {
          const result = applyViewerLayerStyleChanges(
            commands,
            text(style.targetLayerId),
            style.changes || {},
          );
          projectedMutation = projectedMutation || result.changed;
          if (!result.ok) {
            console.warn("Viewer Working Copy replay could not project a style", {
              operationId: operation.id,
              reason: result.error,
            });
          }
          continue;
        }

        const visibility = visibilityPayload(operation);
        if (visibility && text(visibility.targetLayerId)) {
          baseVisibilityRef.current.set(visibility.targetLayerId, visibility.before);
          const result = commands.setLayerVisibility(
            visibility.targetLayerId,
            visibility.after,
          );
          projectedMutation = projectedMutation || (result.ok && result.changed);
          if (!result.ok) {
            console.warn("Viewer Working Copy replay could not project visibility", {
              operationId: operation.id,
              reason: result.reason,
            });
          }
          continue;
        }

        const filter = filterPayload(operation);
        if (filter) {
          if (filter.before) baseFiltersRef.current.set(filter.filterId, filter.before);
          const after = filter.after;
          const current = state.filters.find((candidate) => {
            const logicalId = filterRuntimeAliasRef.current.get(candidate.id) || candidate.id;
            return logicalId === filter.filterId;
          });
          if (!after) {
            if (current) {
              const result = commands.removeFilter(current.index);
              projectedMutation = projectedMutation || (result.ok && result.changed);
            }
            continue;
          }

          let index = current?.index ?? null;
          if (index == null) {
            const created = commands.addFilter(after.dataIds[0]);
            if (!created.ok || !created.value) {
              console.warn("Viewer Working Copy replay could not create a filter", {
                operationId: operation.id,
                reason: created.ok ? "missing filter result" : created.reason,
              });
              continue;
            }
            index = created.value.index;
            filterIndexAliasRef.current.set(index, filter.filterId);
            projectedMutation = projectedMutation || created.changed;
          }
          const bound = commands.bindFilterField(
            index,
            after.dataIds[0],
            after.fieldNames[0],
          );
          const valued = commands.setFilterValue(index, after.value);
          const enabledResult = commands.setFilterEnabled(index, after.enabled);
          projectedMutation = projectedMutation ||
            (bound.ok && bound.changed) ||
            (valued.ok && valued.changed) ||
            (enabledResult.ok && enabledResult.changed);
          if (!bound.ok || !valued.ok || !enabledResult.ok) {
            console.warn("Viewer Working Copy replay could not project a filter", {
              operationId: operation.id,
              bind: bound.ok ? null : bound.reason,
              value: valued.ok ? null : valued.reason,
              enabled: enabledResult.ok ? null : enabledResult.reason,
            });
          }
          continue;
        }

        const order = orderPayload(operation);
        if (order) {
          baseOrderRef.current = [...order.before];
          const result = commands.reorderLayer(order.after);
          projectedMutation = projectedMutation || (result.ok && result.changed);
          if (!result.ok) {
            console.warn("Viewer Working Copy replay could not project layer order", {
              operationId: operation.id,
              reason: result.reason,
            });
          }
        }
      } catch (error) {
        console.warn("Viewer Working Copy replay ignored an operation", {
          operationId: operation.id,
          operationType: operation.type,
          error,
        });
      } finally {
        applyingOperationIdsRef.current.delete(operation.id);
        appliedOperationIdsRef.current.add(operation.id);
      }
    }

    if (projectedMutation) {
      pendingProjectionAckRef.current = true;
    }
  }, [
    commands,
    createDatasetPoint,
    enabled,
    lifecycleReplay,
    runtimeKey,
    state.datasets,
    state.filters,
    state.ready,
    store,
    workingCopy?.updatedAt,
  ]);

  useEffect(() => {
    if (
      !enabled ||
      !store ||
      !store.writable ||
      !state.ready ||
      baseKeyRef.current !== runtimeKey ||
      lifecycleCaptureBusyRef.current
    ) {
      return;
    }

    const command = pendingLifecycleCommandRef.current;
    if (!command) {
      lastLayerStateRef.current = cloneLayerMap(state.layers);
      return;
    }

    const beforeMap = pendingLifecycleBeforeRef.current;
    const currentMap = cloneLayerMap(state.layers);
    const added = state.layers.filter((layer) => !beforeMap.has(layer.id));
    const removed = Array.from(beforeMap.values()).filter(
      (layer) => !currentMap.has(layer.id),
    );

    const expectedDiff =
      command === "removeLayer"
        ? removed.length === 1 && added.length === 0
        : added.length === 1 && removed.length === 0;
    if (!expectedDiff) {
      return;
    }

    pendingLifecycleCommandRef.current = null;
    lifecycleCaptureBusyRef.current = true;
    const currentOrder = state.layers.map((layer) => layer.id);

    void (async () => {
      let next = workingCopy;
      try {
        if (command === "createLayerFromDataset") {
          const layer = added[0];
          const snapshot = snapshotViewerLifecycleLayer(layer);
          if (!snapshot) throw new Error("WORKING_COPY_LAYER_LIFECYCLE_UNSUPPORTED");
          const insertIndex = currentOrder.indexOf(layer.id);
          next = await store.appendOperation(baseRevision, {
            id: `op_${crypto.randomUUID()}`,
            type: "layer.create",
            version: 1,
            payload: {
              layer: snapshot,
              insertIndex,
            } satisfies ViewerLayerCreatePayload,
            createdAt: new Date().toISOString(),
          });
          baseStylesRef.current.set(layer.id, lifecycleStyleSnapshot(snapshot));
          baseVisibilityRef.current.set(layer.id, snapshot.isVisible);
          baseOrderRef.current = [...currentOrder];
        } else if (command === "duplicateLayer") {
          const layer = added[0];
          const snapshot = snapshotViewerLifecycleLayer(layer);
          const insertIndex = currentOrder.indexOf(layer.id);
          const source = snapshot
            ? inferViewerDuplicateSource(
                Array.from(beforeMap.values()),
                layer,
                insertIndex,
              )
            : null;
          if (!snapshot || !source) {
            throw new Error("WORKING_COPY_LAYER_DUPLICATE_SOURCE_UNRESOLVED");
          }
          next = await store.appendOperation(baseRevision, {
            id: `op_${crypto.randomUUID()}`,
            type: "layer.duplicate",
            version: 1,
            payload: {
              sourceLayerId: source.id,
              source,
              layer: snapshot,
              insertIndex,
            } satisfies ViewerLayerDuplicatePayload,
            createdAt: new Date().toISOString(),
          });
          baseStylesRef.current.set(layer.id, lifecycleStyleSnapshot(snapshot));
          baseVisibilityRef.current.set(layer.id, snapshot.isVisible);
          baseOrderRef.current = [...currentOrder];
        } else {
          const layer = removed[0];
          const snapshot = snapshotViewerLifecycleLayer(layer);
          if (!snapshot) throw new Error("WORKING_COPY_LAYER_LIFECYCLE_UNSUPPORTED");
          const previousOrder = Array.from(beforeMap.values())
            .sort((left, right) => left.order - right.order)
            .map((candidate) => candidate.id);
          const previousIndex = previousOrder.indexOf(layer.id);
          const compacted = workingCopy
            ? compactViewerOperationsForLocalLayerRemoval(
                workingCopy.operations,
                layer.id,
              )
            : [];
          const bornLocally = Boolean(
            workingCopy?.operations.some(
              (operation) => viewerLifecycleCreatedLayerId(operation) === layer.id,
            ),
          );
          if (bornLocally && workingCopy) {
            next = await persistCompactedOperations(
              store,
              baseRevision,
              workingCopy,
              compacted,
            );
          } else {
            next = await store.appendOperation(baseRevision, {
              id: `op_${crypto.randomUUID()}`,
              type: "layer.remove",
              version: 1,
              payload: {
                targetLayerId: layer.id,
                before: snapshot,
                previousIndex,
              } satisfies ViewerLayerRemovePayload,
              createdAt: new Date().toISOString(),
            });
          }
          baseOrderRef.current = [...currentOrder];
        }

        onWorkingCopyChange(next);
        untrackedLatchedRef.current = false;
        markClean();
      } catch (error) {
        if (!isWorkingCopyWriteCancelled(error)) {
          console.warn("Viewer Working Copy layer lifecycle capture failed", {
            command,
            error,
          });
        }
        untrackedLatchedRef.current = true;
      } finally {
        lastLayerStateRef.current = currentMap;
        pendingLifecycleBeforeRef.current.clear();
        lifecycleCaptureBusyRef.current = false;
      }
    })();
  }, [
    baseRevision,
    enabled,
    lifecycleSignal,
    markClean,
    onWorkingCopyChange,
    runtimeKey,
    state.layers,
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
      lifecycleCaptureBusyRef.current ||
      pendingLifecycleCommandRef.current ||
      pendingProjectionAckRef.current
    ) {
      return;
    }

    for (const [index, logicalId] of filterIndexAliasRef.current) {
      const runtimeFilter = state.filters.find((filter) => filter.index === index);
      if (!runtimeFilter) continue;
      filterRuntimeAliasRef.current.set(runtimeFilter.id, logicalId);
      filterIndexAliasRef.current.delete(index);
    }

    const localLayerIds = locallyCreatedLayerIds(workingCopy);
    const existingOrder = existingOrderOperation(workingCopy);
    const currentOrder = state.layers.map((layer) => layer.id);
    if (!existingOrder) {
      const unknownIds = currentOrder.filter((id) => !baseOrderRef.current.includes(id));
      if (unknownIds.length && unknownIds.every((id) => localLayerIds.has(id))) {
        baseOrderRef.current = [...currentOrder];
      }
    }

    const styleDiffs = state.layers.flatMap((layer) => {
      const base = baseStylesRef.current.get(layer.id);
      if (!base) return [];
      const changes = diffViewerLayerStyle(base, layer.style);
      const existing = existingStyleOperation(workingCopy, layer.id);
      return [{ layer, changes, existing }];
    });
    const hasStyleDiff = styleDiffs.some(({ changes }) =>
      hasViewerLayerStyleChanges(changes),
    );
    const hasKnownStyleRevert = styleDiffs.some(
      ({ changes, existing }) =>
        Boolean(existing) && !hasViewerLayerStyleChanges(changes),
    );

    const visibilityDiffs = state.layers.flatMap((layer) => {
      const existing = existingVisibilityOperation(workingCopy, layer.id);
      const existingPayload = existing ? visibilityPayload(existing) : null;
      let before = existingPayload?.before ?? baseVisibilityRef.current.get(layer.id);
      if (before == null && localLayerIds.has(layer.id) && !existing) {
        baseVisibilityRef.current.set(layer.id, layer.isVisible);
        before = layer.isVisible;
      }
      if (before == null) return [];
      return [{
        layer,
        before,
        after: layer.isVisible,
        existing,
        existingPayload,
      }];
    });
    const pendingVisibility = visibilityDiffs.filter(
      ({ layer, before, after, existingPayload }) =>
        before !== after
          ? !existingPayload ||
            existingPayload.after !== after ||
            existingPayload.targetDataId !== (layer.dataIds[0] || null) ||
            existingPayload.targetLabel !== layer.label
          : Boolean(existingPayload),
    );

    const currentFilters = new Map<string, ViewerPersistentFilterSnapshot>();
    for (const filter of state.filters) {
      const logicalId =
        filterRuntimeAliasRef.current.get(filter.id) ||
        filterIndexAliasRef.current.get(filter.index) ||
        filter.id;
      const snapshot = snapshotViewerPersistentFilter(filter, logicalId);
      if (snapshot) currentFilters.set(logicalId, snapshot);
    }
    const filterIds = new Set([
      ...baseFiltersRef.current.keys(),
      ...currentFilters.keys(),
      ...(workingCopy?.operations.flatMap((operation) => {
        const payload = filterPayload(operation);
        return payload ? [payload.filterId] : [];
      }) || []),
    ]);
    const pendingFilters = Array.from(filterIds).flatMap((filterId) => {
      const existing = existingFilterOperation(workingCopy, filterId);
      const existingPayload = existing ? filterPayload(existing) : null;
      const before = existingPayload?.before ?? baseFiltersRef.current.get(filterId) ?? null;
      const after = currentFilters.get(filterId) ?? null;
      if (viewerJsonEqual(before, after)) {
        return existing ? [{ filterId, before, after, existing, remove: true }] : [];
      }
      if (existingPayload && viewerJsonEqual(existingPayload.after, after)) return [];
      return [{ filterId, before, after, existing, remove: false }];
    });

    const orderExistingPayload = existingOrder ? orderPayload(existingOrder) : null;
    const orderBefore = orderExistingPayload?.before || baseOrderRef.current;
    const orderChanged = !viewerJsonEqual(orderBefore, currentOrder);
    const pendingOrder = orderChanged
      ? !orderExistingPayload || !viewerJsonEqual(orderExistingPayload.after, currentOrder)
      : Boolean(orderExistingPayload);

    const hasRecognizedVisualizationChange =
      pendingVisibility.length > 0 ||
      pendingFilters.length > 0 ||
      pendingOrder;

    if (
      state.hasUnsavedChanges &&
      !hasStyleDiff &&
      !hasKnownStyleRevert &&
      !hasRecognizedVisualizationChange &&
      !pendingProjectionAckRef.current
    ) {
      untrackedLatchedRef.current = true;
      return;
    }

    const pendingStyles = styleDiffs.filter(({ layer, changes, existing }) => {
      const payload = stylePayload(existing || ({} as ViewerChangeOperation));
      if (!hasViewerLayerStyleChanges(changes)) return Boolean(existing);
      return !viewerLayerStyleChangesEqual(payload?.changes, changes) ||
        text(payload?.targetDataId) !== (layer.dataIds[0] || "") ||
        text(payload?.targetLabel) !== layer.label;
    });

    if (
      !pendingStyles.length &&
      !pendingVisibility.length &&
      !pendingFilters.length &&
      !pendingOrder
    ) {
      lastLayerStateRef.current = cloneLayerMap(state.layers);
      return;
    }

    captureBusyRef.current = true;
    void (async () => {
      let next = workingCopy;
      try {
        for (const { layer, changes } of pendingStyles) {
          if (!store.writable) return;
          const metadata = baseLayerMeta.get(layer.id) || {
            dataId: layer.dataIds[0] || null,
            label: layer.label,
          };
          next = await store.upsertLayerStyleOperation(baseRevision, {
            targetLayerId: layer.id,
            targetDataId: metadata.dataId,
            targetLabel: metadata.label,
            changes,
          });
        }

        for (const { layer, before, after, existing } of pendingVisibility) {
          if (!store.writable) return;
          next = await replaceViewerOperation(
            store,
            baseRevision,
            existing,
            "layer.visibility.update",
            {
              targetLayerId: layer.id,
              targetDataId: layer.dataIds[0] || null,
              targetLabel: layer.label,
              before,
              after,
            } satisfies ViewerLayerVisibilityUpdatePayload,
            before === after,
          );
        }

        for (const { filterId, before, after, existing, remove } of pendingFilters) {
          if (!store.writable) return;
          next = await replaceViewerOperation(
            store,
            baseRevision,
            existing,
            "persistent.filter.update",
            {
              filterId,
              before,
              after,
            } satisfies ViewerPersistentFilterUpdatePayload,
            remove,
          );
        }

        if (pendingOrder) {
          if (!store.writable) return;
          next = await replaceViewerOperation(
            store,
            baseRevision,
            existingOrder,
            "layer.order.update",
            {
              before: [...orderBefore],
              after: [...currentOrder],
            } satisfies ViewerLayerOrderUpdatePayload,
            !orderChanged,
          );
        }

        if (!store.writable) return;
        onWorkingCopyChange(next);
        if (!untrackedLatchedRef.current) markClean();
      } catch (error) {
        if (!isWorkingCopyWriteCancelled(error)) {
          console.warn("Viewer Working Copy visualization capture failed", { error });
        }
      } finally {
        lastLayerStateRef.current = cloneLayerMap(state.layers);
        captureBusyRef.current = false;
      }
    })();
  }, [
    baseLayerMeta,
    baseRevision,
    enabled,
    markClean,
    onWorkingCopyChange,
    runtimeKey,
    state.filters,
    state.hasUnsavedChanges,
    state.layers,
    state.ready,
    store,
    workingCopy,
  ]);

  useEffect(() => {
    if (!enabled || !pendingProjectionAckRef.current) {
      return;
    }

    pendingProjectionAckRef.current = false;
    lastLayerStateRef.current = cloneLayerMap(state.layers);
    if (state.hasUnsavedChanges && !untrackedLatchedRef.current) {
      markClean();
    }
  }, [enabled, markClean, state.hasUnsavedChanges, state.layers, state.save.revisionHash]);

  return null;
}
