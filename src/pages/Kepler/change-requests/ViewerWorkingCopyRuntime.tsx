import { useEffect, useMemo, useRef } from "react";

import { useKeplerEngineAdapter } from "../engine-adapter";
import {
  type PointDatasetTarget,
  usePointDatasetCommand,
} from "../engine-adapter/usePointDatasetCommand";
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

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown) {
  return String(value ?? "").trim();
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
  }
  return ids;
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

export default function ViewerWorkingCopyRuntime({
  enabled,
  store,
  workingCopy,
  baseRevision,
  onWorkingCopyChange,
}: Props) {
  const { commands, markClean, state } = useKeplerEngineAdapter();
  const createDatasetPoint = usePointDatasetCommand();
  const runtimeKey = `${store?.key || "none"}:${baseRevision}`;
  const baseKeyRef = useRef("");
  const baseStylesRef = useRef(new Map<string, ViewerLayerStyleSnapshot>());
  const baseVisibilityRef = useRef(new Map<string, boolean>());
  const baseFiltersRef = useRef(new Map<string, ViewerPersistentFilterSnapshot>());
  const baseOrderRef = useRef<string[]>([]);
  const filterIndexAliasRef = useRef(new Map<number, string>());
  const filterRuntimeAliasRef = useRef(new Map<string, string>());
  const captureBusyRef = useRef(false);
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
    filterIndexAliasRef.current.clear();
    filterRuntimeAliasRef.current.clear();
    captureBusyRef.current = false;
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
        // A persisted local operation must never take down the whole Viewer.
        // Invalid operations are sanitized on load; this guard also contains
        // adapter/runtime failures during projection.
        console.warn("Viewer Working Copy replay ignored an operation", {
          operationId: operation.id,
          operationType: operation.type,
          error,
        });
      } finally {
        applyingOperationIdsRef.current.delete(operation.id);
        // Cada operação é materializada no máximo uma vez por runtimeKey.
        // Falhas ficam isoladas nesta sessão para impedir loops de replay; um
        // reload cria um novo runtime e oferece uma nova tentativa segura.
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
      captureBusyRef.current ||
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
    if (state.hasUnsavedChanges && !untrackedLatchedRef.current) {
      markClean();
    }
  }, [enabled, markClean, state.hasUnsavedChanges, state.save.revisionHash]);

  return null;
}
