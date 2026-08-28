import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router";

import { useKeplerEngineAdapter } from "../../engine-adapter";
import { useMultiBufferDatasetUpdater } from "../../engine-adapter/multibuffer-dataset-updater";
import {
  bufferErrorMessage,
  formatBufferEditableNumber,
  isBufferAbortError,
  requestBuffer,
  type BufferUnit,
} from "../../map-panel/buffer-api";
import { useMapPanel } from "../../map-panel/MapPanelContext";
import { emitMapPanelTelemetry } from "../../map-panel/map-panel-telemetry";
import {
  appendBufferSessionResult,
  bufferSessionFeatureCount,
  createBufferSession,
  type BufferSession,
} from "./analysis-tools/buffer-session";
import type {
  BufferToolSession,
  MapToolPoint,
} from "./analysis-tools/map-tool-state";

export type BufferPreviewState = {
  dataId: string;
  label: string;
  ranges: number[];
  inputUnit: BufferUnit | "mixed";
  rangesMeters: number[];
  isMulti: boolean;
  itemCount: number;
  featureCount: number;
};

export type BufferOverlayMessage = {
  tone: "error" | "success";
  text: string;
};

export type BufferInput = {
  unit: BufferUnit;
  ranges: number[];
};

const BUFFER_LEGEND_PALETTE = [
  "#FFF8E7",
  "#F1D28A",
  "#D69E2E",
  "#B7791F",
];

function rangeLabel(value: number, unit: BufferUnit) {
  return `${formatBufferEditableNumber(value)} ${unit}`;
}

function previewLabel(input: {
  ranges: number[];
  inputUnit: BufferUnit;
}) {
  return `Buffer radial · ${input.ranges
    .map((value) => rangeLabel(value, input.inputUnit))
    .join(", ")}`;
}

function multiPreview(session: BufferSession): BufferPreviewState {
  const units = new Set(session.items.map((item) => item.inputUnit));
  const ranges = session.items.flatMap((item) => item.ranges);
  const rangesMeters = session.items.flatMap((item) => item.rangesMeters);
  const featureCount = bufferSessionFeatureCount(session);
  const itemCount = session.items.length;

  return {
    dataId: session.dataId,
    label: `Multibuffers · ${itemCount} ${itemCount === 1 ? "origem" : "origens"} · ${featureCount} ${featureCount === 1 ? "buffer" : "buffers"}`,
    ranges,
    inputUnit: units.size === 1 ? session.items[0].inputUnit : "mixed",
    rangesMeters,
    isMulti: true,
    itemCount,
    featureCount,
  };
}

export function useBufferPreview({
  pendingPoint,
  session,
  onMarkerReset,
}: {
  pendingPoint: MapToolPoint | null;
  session: BufferToolSession | null;
  onMarkerReset: () => void;
}) {
  const { projectSlug } = useParams();
  const { context } = useMapPanel();
  const { commands } = useKeplerEngineAdapter();
  const updateMultiBufferDataset = useMultiBufferDatasetUpdater();
  const capabilities = context?.capabilities;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BufferPreviewState | null>(null);
  const [message, setMessage] = useState<BufferOverlayMessage | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const previewRef = useRef<BufferPreviewState | null>(null);
  const multiSessionRef = useRef<BufferSession | null>(null);
  const commandsRef = useRef(commands);
  const resetMarkerRef = useRef(onMarkerReset);
  const scopeKey = [
    context?.organization?.id ?? "none",
    context?.project?.id ?? "none",
    projectSlug ?? "none",
  ].join(":");
  const previousScopeKeyRef = useRef(scopeKey);
  const multiMode = session?.insertionMode === "multi";

  previewRef.current = preview;
  commandsRef.current = commands;
  resetMarkerRef.current = onMarkerReset;

  useEffect(() => {
    if (!message || message.tone === "error") return undefined;

    const timeoutId = window.setTimeout(() => setMessage(null), 6_000);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  useEffect(() => {
    if (pendingPoint) return;
    setDialogOpen(false);
    setError(null);
  }, [pendingPoint]);

  useEffect(() => {
    if (!session) return;
    if (multiSessionRef.current?.id === session.id) return;

    multiSessionRef.current = createBufferSession(
      session.id,
      session.dataId || undefined,
    );
  }, [session]);

  useEffect(() => {
    if (previousScopeKeyRef.current === scopeKey) return;
    previousScopeKeyRef.current = scopeKey;

    requestRef.current?.abort();
    requestRef.current = null;
    setBusy(false);

    const current = previewRef.current;
    if (current) {
      commandsRef.current.removeTransientLayer(current.dataId, "buffer");
    }

    multiSessionRef.current = null;
    setPreview(null);
    setDialogOpen(false);
    setError(null);
    setMessage(null);
    resetMarkerRef.current();
  }, [scopeKey]);

  useEffect(
    () => () => {
      requestRef.current?.abort();
      const current = previewRef.current;

      if (current) {
        commandsRef.current.removeTransientLayer(current.dataId, "buffer");
      }
    },
    [],
  );

  const openDialog = useCallback(() => {
    if (
      !pendingPoint ||
      !capabilities?.previewBuffer ||
      (!multiMode && preview)
    ) {
      return;
    }
    setError(null);
    setDialogOpen(true);
  }, [capabilities?.previewBuffer, multiMode, pendingPoint, preview]);

  const closeDialog = useCallback(() => {
    if (busy) return;
    setDialogOpen(false);
    setError(null);
  }, [busy]);

  const generate = useCallback(
    async (input: BufferInput) => {
      if (
        busy ||
        !pendingPoint ||
        !capabilities?.previewBuffer ||
        (!multiMode && preview)
      ) {
        return;
      }

      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setBusy(true);
      setError(null);
      setMessage(null);
      emitMapPanelTelemetry("map_buffer_requested", {
        mode: context?.mode ?? null,
        projectId: context?.project?.id ?? null,
        organizationId: context?.organization?.id ?? null,
        source: "map-overlay",
        analysisType: multiMode ? "multi_radial_buffer" : "radial_buffer",
        rangeCount: input.ranges.length,
        unit: input.unit,
      });

      try {
        const result = await requestBuffer(
          {
            projectSlug: projectSlug || null,
            origin: pendingPoint,
            unit: input.unit,
            ranges: input.ranges,
          },
          controller.signal,
        );

        if (multiMode && session) {
          const baseSession =
            multiSessionRef.current?.id === session.id
              ? multiSessionRef.current
              : createBufferSession(session.id, session.dataId || undefined);
          const nextSession = appendBufferSessionResult(baseSession, {
            origin: pendingPoint,
            result,
          });
          const firstItem = baseSession.items.length === 0;

          if (firstItem) {
            const added = commands.addGeoJsonLayer({
              dataId: nextSession.dataId,
              label: "Multibuffers",
              geoJson: nextSession.geojson,
              color: [197, 160, 89],
              strokeColor: [183, 121, 31],
              opacity: 0.2,
              transient: true,
              analysisKind: "buffer",
              presentation: {
                tooltipFields: [
                  "analysis_label",
                  "radius_label",
                  "origin_latitude",
                  "origin_longitude",
                  "maono_buffer_item_id",
                ],
                legendField: "radius_label",
                legendPalette: BUFFER_LEGEND_PALETTE,
              },
              centerMap: false,
            });

            if (!added.ok || !added.value?.dataId) {
              throw new Error(
                added.ok
                  ? "O adaptador não retornou a camada da sessão Multibuffer."
                  : added.reason,
              );
            }
          } else {
            const updated = updateMultiBufferDataset({
              dataId: nextSession.dataId,
              label: "Multibuffers",
              geoJson: nextSession.geojson,
            });
            if (!updated.ok) {
              throw new Error(updated.reason);
            }
          }

          multiSessionRef.current = nextSession;
          const nextPreview = multiPreview(nextSession);
          setPreview(nextPreview);
          setDialogOpen(false);

          emitMapPanelTelemetry("map_multibuffer_item_confirmed", {
            mode: context?.mode ?? null,
            projectId: context?.project?.id ?? null,
            organizationId: context?.organization?.id ?? null,
            source: "map-overlay",
            sessionId: nextSession.id,
            dataId: nextSession.dataId,
            itemCount: nextPreview.itemCount,
            featureCount: nextPreview.featureCount,
            rangeCount: result.metadata.ranges.length,
            unit: result.metadata.inputUnit,
          });
          return;
        }

        const label = previewLabel(result.metadata);
        const added = commands.addGeoJsonLayer({
          label,
          geoJson: result.geojson,
          color: [197, 160, 89],
          strokeColor: [183, 121, 31],
          opacity: 0.2,
          transient: true,
          analysisKind: "buffer",
          presentation: {
            tooltipFields: ["analysis_label", "radius_label"],
            legendField: "radius_label",
            legendPalette: BUFFER_LEGEND_PALETTE,
          },
          centerMap: true,
        });

        if (!added.ok || !added.value?.dataId) {
          throw new Error(
            added.ok
              ? "O adaptador não retornou a camada de prévia."
              : added.reason,
          );
        }

        setPreview({
          dataId: added.value.dataId,
          label,
          ranges: result.metadata.ranges,
          inputUnit: result.metadata.inputUnit,
          rangesMeters: result.metadata.rangesMeters,
          isMulti: false,
          itemCount: 1,
          featureCount: result.metadata.featureCount,
        });
        setDialogOpen(false);
        emitMapPanelTelemetry("map_buffer_previewed", {
          mode: context?.mode ?? null,
          projectId: context?.project?.id ?? null,
          organizationId: context?.organization?.id ?? null,
          source: "map-overlay",
          analysisType: "radial_buffer",
          rangeCount: result.metadata.ranges.length,
          featureCount: result.metadata.featureCount,
          unit: result.metadata.inputUnit,
          antimeridianSplitCount:
            result.metadata.antimeridianSplitCount ?? 0,
        });
      } catch (requestError) {
        if (isBufferAbortError(requestError)) return;

        const text = bufferErrorMessage(requestError);
        setError(text);
        emitMapPanelTelemetry("map_buffer_failed", {
          mode: context?.mode ?? null,
          projectId: context?.project?.id ?? null,
          organizationId: context?.organization?.id ?? null,
          source: "map-overlay",
          analysisType: multiMode ? "multi_radial_buffer" : "radial_buffer",
          code:
            requestError &&
            typeof requestError === "object" &&
            "code" in requestError
              ? String(requestError.code)
              : "BUFFER_CLIENT_ERROR",
        });
      } finally {
        if (requestRef.current === controller) {
          requestRef.current = null;
        }
        setBusy(false);
      }
    },
    [
      busy,
      capabilities?.previewBuffer,
      commands,
      context?.mode,
      context?.organization?.id,
      context?.project?.id,
      multiMode,
      pendingPoint,
      preview,
      projectSlug,
      session,
      updateMultiBufferDataset,
    ],
  );

  const discard = useCallback(() => {
    if (!preview) return false;

    const result = commands.removeTransientLayer(preview.dataId, "buffer");
    if (!result.ok) {
      setMessage({
        tone: "error",
        text: result.reason || "Não foi possível descartar a prévia.",
      });
      return false;
    }

    emitMapPanelTelemetry("map_buffer_discarded", {
      mode: context?.mode ?? null,
      projectId: context?.project?.id ?? null,
      organizationId: context?.organization?.id ?? null,
      source: "map-overlay",
      analysisType: preview.isMulti ? "multi_radial_buffer" : "radial_buffer",
      rangeCount: preview.rangesMeters.length,
      unit: preview.inputUnit,
      itemCount: preview.itemCount,
      featureCount: preview.featureCount,
    });
    multiSessionRef.current = null;
    setPreview(null);
    return true;
  }, [
    commands,
    context?.mode,
    context?.organization?.id,
    context?.project?.id,
    preview,
  ]);

  const keep = useCallback(() => {
    if (!preview || !capabilities?.persistBuffer) {
      return false;
    }

    const result = commands.markLayerPersistent(preview.dataId, "buffer");
    if (!result.ok) {
      setMessage({
        tone: "error",
        text: result.reason || "Não foi possível manter o Buffer no mapa.",
      });
      return false;
    }

    emitMapPanelTelemetry("map_buffer_kept", {
      mode: context?.mode ?? null,
      projectId: context?.project?.id ?? null,
      organizationId: context?.organization?.id ?? null,
      source: "map-overlay",
      analysisType: preview.isMulti ? "multi_radial_buffer" : "radial_buffer",
      rangeCount: preview.rangesMeters.length,
      itemCount: preview.itemCount,
      featureCount: preview.featureCount,
      unit: preview.inputUnit,
    });
    multiSessionRef.current = null;
    setPreview(null);
    resetMarkerRef.current();
    setMessage({
      tone: "success",
      text: preview.isMulti
        ? "Multibuffers mantidos no mapa. Salve o projeto para gravar as alterações."
        : "Buffer mantido no mapa. Salve o projeto para gravar as alterações.",
    });
    return true;
  }, [
    capabilities?.persistBuffer,
    commands,
    context?.mode,
    context?.organization?.id,
    context?.project?.id,
    preview,
  ]);

  return {
    dialogOpen,
    busy,
    error,
    preview,
    message,
    setMessage,
    openDialog,
    closeDialog,
    generate,
    discard,
    keep,
  };
}
