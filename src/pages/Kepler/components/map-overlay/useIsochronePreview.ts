import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router";

import { useKeplerEngineAdapter } from "../../engine-adapter";
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
    if (current) {
      commandsRef.current.removeTransientLayer(current.dataId, "isochrone");
    }

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
        commandsRef.current.removeTransientLayer(current.dataId, "isochrone");
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
          analysisKind: "isochrone",
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
    if (!preview) return false;

    const result = commands.removeTransientLayer(preview.dataId, "isochrone");
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

  const keep = useCallback(() => {
    if (!preview || !capabilities?.persistIsochrone) {
      return false;
    }

    const result = commands.markLayerPersistent(preview.dataId, "isochrone");
    if (!result.ok) {
      setMessage({
        tone: "error",
        text: result.reason || "Não foi possível manter a isócrona no mapa.",
      });
      return false;
    }

    emitMapPanelTelemetry("map_isochrone_kept", {
      mode: context?.mode ?? null,
      projectId: context?.project?.id ?? null,
      organizationId: context?.organization?.id ?? null,
      source: "map-overlay",
    });
    setPreview(null);
    resetMarkerRef.current();
    setMessage({
      tone: "success",
      text: "Isócrona mantida no mapa. Salve o projeto para gravar as alterações.",
    });
    return true;
  }, [
    capabilities?.persistIsochrone,
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
