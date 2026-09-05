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
    captureBusyRef.current = false;
    pendingProjectionAckRef.current = false;
    untrackedLatchedRef.current = false;
    applyingOperationIdsRef.current.clear();
    appliedOperationIdsRef.current.clear();
  }, [enabled, runtimeKey, state.layers, state.ready, store]);

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

    const diffs = state.layers.flatMap((layer) => {
      const base = baseStylesRef.current.get(layer.id);
      if (!base) return [];
      const changes = diffViewerLayerStyle(base, layer.style);
      const existing = existingStyleOperation(workingCopy, layer.id);
      return [{ layer, changes, existing }];
    });
    const hasStyleDiff = diffs.some(({ changes }) =>
      hasViewerLayerStyleChanges(changes),
    );
    const hasKnownRevert = diffs.some(
      ({ changes, existing }) =>
        Boolean(existing) && !hasViewerLayerStyleChanges(changes),
    );

    if (
      state.hasUnsavedChanges &&
      !hasStyleDiff &&
      !hasKnownRevert &&
      !pendingProjectionAckRef.current
    ) {
      untrackedLatchedRef.current = true;
      return;
    }

    const pending = diffs.filter(({ layer, changes, existing }) => {
      const payload = stylePayload(existing || ({} as ViewerChangeOperation));
      if (!hasViewerLayerStyleChanges(changes)) return Boolean(existing);
      return !viewerLayerStyleChangesEqual(payload?.changes, changes) ||
        text(payload?.targetDataId) !== (layer.dataIds[0] || "") ||
        text(payload?.targetLabel) !== layer.label;
    });
    if (!pending.length) return;

    captureBusyRef.current = true;
    void (async () => {
      let next = workingCopy;
      try {
        for (const { layer, changes } of pending) {
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
        if (!store.writable) return;
        onWorkingCopyChange(next);
        if (!untrackedLatchedRef.current) markClean();
      } catch (error) {
        if (!isWorkingCopyWriteCancelled(error)) {
          console.warn("Viewer Working Copy style capture failed", { error });
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
