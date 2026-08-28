import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router";

import { useKeplerEngineAdapter } from "../../engine-adapter";
import {
  bufferErrorMessage,
  formatBufferEditableNumber,
  isBufferAbortError,
  requestBuffer,
  type BufferUnit,
} from "../../map-panel/buffer-api";
import {
  dispatchMapSaveRequest,
  MAONO_MAP_SAVE_RESULT_EVENT,
  mapSaveResultFromEvent,
} from "../../map-panel/map-save-events";
import { useMapPanel } from "../../map-panel/MapPanelContext";
import { emitMapPanelTelemetry } from "../../map-panel/map-panel-telemetry";
import type { MarkerOrigin } from "./marker-projection";

export type BufferPreviewState = {
  dataId: string;
  label: string;
  ranges: number[];
  inputUnit: BufferUnit;
  rangesMeters: number[];
  canPersist: boolean;
  saveRequestId: string | null;
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

export function useBufferPreview({
  origin,
  onMarkerReset,
}: {
  origin: MarkerOrigin | null;
  onMarkerReset: () => void;
}) {
  const { projectSlug } = useParams();
  const { context } = useMapPanel();
  const { commands } = useKeplerEngineAdapter();
  const capabilities = context?.capabilities;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<BufferPreviewState | null>(null);
  const [message, setMessage] = useState<BufferOverlayMessage | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const previewRef = useRef<BufferPreviewState | null>(null);
  const commandsRef = useRef(commands);
  const resetMarkerRef = useRef(onMarkerReset);
  const scopeKey = [
    context?.organization?.id ?? "none",
    context?.project?.id ?? "none",
    projectSlug ?? "none",
  ].join(":");
  const previousScopeKeyRef = useRef(scopeKey);

  previewRef.current = preview;
  commandsRef.current = commands;
  resetMarkerRef.current = onMarkerReset;

  useEffect(() => {
    if (!message || message.tone === "error") return undefined;

    const timeoutId = window.setTimeout(() => setMessage(null), 6_000);
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  useEffect(() => {
    if (origin) return;
    setDialogOpen(false);
    setError(null);
  }, [origin]);

  useEffect(() => {
    if (previousScopeKeyRef.current === scopeKey) return;
    previousScopeKeyRef.current = scopeKey;

    requestRef.current?.abort();
    requestRef.current = null;
    setBusy(false);

    const current = previewRef.current;
    if (current && !current.saveRequestId) {
      commandsRef.current.removeTransientLayer(current.dataId, "buffer");
    }

    setPreview(null);
    setDialogOpen(false);
    setError(null);
    setMessage(null);
    resetMarkerRef.current();
  }, [scopeKey]);

  useEffect(() => {
    function handleSaveResult(event: Event) {
      const result = mapSaveResultFromEvent(event);
      const current = previewRef.current;

      if (
        !result ||
        result.source !== "buffer-preview" ||
        !current ||
        result.requestId !== current.saveRequestId ||
        result.dataId !== current.dataId
      ) {
        return;
      }

      if (result.status === "success") {
        setPreview(null);
        resetMarkerRef.current();
        setMessage({
          tone: "success",
          text: "O Buffer foi salvo no projeto.",
        });
        emitMapPanelTelemetry("map_buffer_persisted", {
          mode: context?.mode ?? null,
          projectId: context?.project?.id ?? null,
          organizationId: context?.organization?.id ?? null,
          source: "map-overlay",
          analysisType: "radial_buffer",
          rangeCount: current.ranges.length,
          unit: current.inputUnit,
        });
        return;
      }

      setPreview((value) =>
        value?.dataId === result.dataId
          ? { ...value, saveRequestId: null }
          : value,
      );
      setMessage({
        tone: "error",
        text:
          result.message ||
          (result.status === "cancelled"
            ? "O salvamento do Buffer foi cancelado. A prévia foi preservada."
            : "Não foi possível salvar o Buffer. A prévia foi preservada."),
      });
      emitMapPanelTelemetry("map_buffer_persist_failed", {
        mode: context?.mode ?? null,
        projectId: context?.project?.id ?? null,
        organizationId: context?.organization?.id ?? null,
        source: "map-overlay",
        analysisType: "radial_buffer",
        rangeCount: current.ranges.length,
        unit: current.inputUnit,
        status: result.status,
      });
    }

    window.addEventListener(MAONO_MAP_SAVE_RESULT_EVENT, handleSaveResult);
    return () =>
      window.removeEventListener(MAONO_MAP_SAVE_RESULT_EVENT, handleSaveResult);
  }, [
    context?.mode,
    context?.organization?.id,
    context?.project?.id,
  ]);

  useEffect(
    () => () => {
      requestRef.current?.abort();
      const current = previewRef.current;

      if (current && !current.saveRequestId) {
        commandsRef.current.removeTransientLayer(current.dataId, "buffer");
      }
    },
    [],
  );

  const openDialog = useCallback(() => {
    if (!origin || !capabilities?.previewBuffer || preview) return;
    setError(null);
    setDialogOpen(true);
  }, [capabilities?.previewBuffer, origin, preview]);

  const closeDialog = useCallback(() => {
    if (busy) return;
    setDialogOpen(false);
    setError(null);
  }, [busy]);

  const generate = useCallback(
    async (input: BufferInput) => {
      if (
        busy ||
        !origin ||
        !capabilities?.previewBuffer ||
        preview
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
        analysisType: "radial_buffer",
        rangeCount: input.ranges.length,
        unit: input.unit,
      });

      try {
        const result = await requestBuffer(
          {
            projectSlug: projectSlug || null,
            origin,
            unit: input.unit,
            ranges: input.ranges,
          },
          controller.signal,
        );
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
          canPersist: result.metadata.canPersist,
          saveRequestId: null,
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
          analysisType: "radial_buffer",
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
      origin,
      preview,
      projectSlug,
    ],
  );

  const discard = useCallback(() => {
    if (!preview || preview.saveRequestId) return false;

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
      analysisType: "radial_buffer",
      rangeCount: preview.ranges.length,
      unit: preview.inputUnit,
    });
    setPreview(null);
    return true;
  }, [
    commands,
    context?.mode,
    context?.organization?.id,
    context?.project?.id,
    preview,
  ]);

  const persist = useCallback(() => {
    if (
      !preview ||
      preview.saveRequestId ||
      !preview.canPersist ||
      !capabilities?.persistBuffer
    ) {
      return false;
    }

    emitMapPanelTelemetry("map_buffer_persist_requested", {
      mode: context?.mode ?? null,
      projectId: context?.project?.id ?? null,
      organizationId: context?.organization?.id ?? null,
      source: "map-overlay",
      analysisType: "radial_buffer",
      rangeCount: preview.ranges.length,
      unit: preview.inputUnit,
    });
    const request = dispatchMapSaveRequest({
      source: "buffer-preview",
      dataId: preview.dataId,
    });

    setPreview({
      ...preview,
      saveRequestId: request.requestId,
    });
    setMessage({
      tone: "success",
      text:
        context?.mode === "create"
          ? "Conclua os dados do novo projeto para salvar o Buffer."
          : "Salvando o Buffer no projeto…",
    });
    return true;
  }, [
    capabilities?.persistBuffer,
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
    persist,
  };
}
