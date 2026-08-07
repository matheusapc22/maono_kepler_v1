import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router";

import { useKeplerEngineAdapter } from "../../engine-adapter";
import {
  dispatchMapSaveRequest,
  MAONO_MAP_SAVE_RESULT_EVENT,
  mapSaveResultFromEvent,
} from "../../map-panel/map-save-events";
import { emitMapPanelTelemetry } from "../../map-panel/map-panel-telemetry";
import { useMapPanel } from "../../map-panel/MapPanelContext";
import {
  isIsochroneAbortError,
  isochroneErrorMessage,
  requestIsochrone,
  type IsochroneMode,
  type IsochroneType,
} from "../../map-panel/isochrone-api";
import type { MarkerOrigin } from "./marker-projection";

export type IsochronePreviewState = {
  dataId: string;
  label: string;
  canPersist: boolean;
  saveRequestId: string | null;
};

export type IsochroneOverlayMessage = {
  tone: "error" | "success";
  text: string;
};

export type IsochroneInput = {
  type: IsochroneType;
  mode: IsochroneMode;
  ranges: number[];
};

function modeLabel(mode: IsochroneMode) {
  return {
    drive_traffic: "Carro com trânsito",
    drive: "Carro",
    bicycle: "Bicicleta",
    walk: "Caminhada",
  }[mode];
}

function previewLabel(input: IsochroneInput) {
  const unit = input.type === "time" ? "min" : "km";
  return `Análise: ${modeLabel(input.mode)} · ${input.ranges.join(", ")} ${unit}`;
}

export function useIsochronePreview({
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
  const [preview, setPreview] = useState<IsochronePreviewState | null>(null);
  const [message, setMessage] = useState<IsochroneOverlayMessage | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const previewRef = useRef<IsochronePreviewState | null>(null);
  const commandsRef = useRef(commands);
  const resetMarkerRef = useRef(onMarkerReset);

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
    function handleSaveResult(event: Event) {
      const result = mapSaveResultFromEvent(event);
      const current = previewRef.current;

      if (
        !result ||
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
          text: "A isócrona foi salva no projeto.",
        });
        emitMapPanelTelemetry("map_isochrone_persisted", {
          mode: context?.mode ?? null,
          projectId: context?.project?.id ?? null,
          organizationId: context?.organization?.id ?? null,
          source: "map-overlay",
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
            ? "O salvamento da isócrona foi cancelado."
            : "Não foi possível salvar a isócrona."),
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
        commandsRef.current.removeTransientLayer(current.dataId);
      }
    },
    [],
  );

  const openDialog = useCallback(() => {
    if (!origin || !capabilities?.previewIsochrone || preview) return;
    setError(null);
    setDialogOpen(true);
  }, [capabilities?.previewIsochrone, origin, preview]);

  const closeDialog = useCallback(() => {
    if (busy) return;
    setDialogOpen(false);
    setError(null);
  }, [busy]);

  const generate = useCallback(
    async (input: IsochroneInput) => {
      if (
        busy ||
        !origin ||
        !capabilities?.previewIsochrone ||
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
      emitMapPanelTelemetry("map_isochrone_requested", {
        mode: context?.mode ?? null,
        projectId: context?.project?.id ?? null,
        organizationId: context?.organization?.id ?? null,
        source: "map-overlay",
        analysisType: input.type,
        travelMode: input.mode,
        rangeCount: input.ranges.length,
      });

      try {
        const result = await requestIsochrone(
          {
            projectSlug: projectSlug || null,
            origin,
            type: input.type,
            mode: input.mode,
            ranges: input.ranges,
          },
          controller.signal,
        );
        const label = previewLabel(input);
        const added = commands.addGeoJsonLayer({
          label,
          geoJson: result.geojson,
          color: [197, 160, 89],
          strokeColor: [183, 121, 31],
          opacity: 0.28,
          transient: true,
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
          canPersist: result.metadata.canPersist,
          saveRequestId: null,
        });
        setDialogOpen(false);
        emitMapPanelTelemetry("map_isochrone_previewed", {
          mode: context?.mode ?? null,
          projectId: context?.project?.id ?? null,
          organizationId: context?.organization?.id ?? null,
          source: "map-overlay",
          analysisType: input.type,
          travelMode: input.mode,
          rangeCount: input.ranges.length,
          featureCount: result.metadata.featureCount,
        });
      } catch (requestError) {
        if (isIsochroneAbortError(requestError)) return;

        const text = isochroneErrorMessage(requestError);
        setError(text);
        emitMapPanelTelemetry("map_isochrone_failed", {
          mode: context?.mode ?? null,
          projectId: context?.project?.id ?? null,
          organizationId: context?.organization?.id ?? null,
          source: "map-overlay",
          code:
            requestError &&
            typeof requestError === "object" &&
            "code" in requestError
              ? String(requestError.code)
              : "ISOCHRONE_CLIENT_ERROR",
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
      capabilities?.previewIsochrone,
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

    const result = commands.removeTransientLayer(preview.dataId);
    if (!result.ok) {
      setMessage({
        tone: "error",
        text: result.reason || "Não foi possível descartar a prévia.",
      });
      return false;
    }

    emitMapPanelTelemetry("map_isochrone_discarded", {
      mode: context?.mode ?? null,
      projectId: context?.project?.id ?? null,
      organizationId: context?.organization?.id ?? null,
      source: "map-overlay",
    });
    setPreview(null);
    onMarkerReset();
    return true;
  }, [
    commands,
    context?.mode,
    context?.organization?.id,
    context?.project?.id,
    onMarkerReset,
    preview,
  ]);

  const persist = useCallback(() => {
    if (
      !preview ||
      preview.saveRequestId ||
      !preview.canPersist ||
      !capabilities?.persistIsochrone
    ) {
      return false;
    }

    const request = dispatchMapSaveRequest({
      source: "isochrone-preview",
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
          ? "Conclua os dados do novo projeto para salvar a isócrona."
          : "Salvando a isócrona no projeto…",
    });
    return true;
  }, [
    capabilities?.persistIsochrone,
    context?.mode,
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
