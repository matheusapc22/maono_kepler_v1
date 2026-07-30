import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useParams } from "react-router";
import { WebMercatorViewport } from "@deck.gl/core";

import {
  useKeplerEngineAdapter,
  type KeplerCommandResult,
} from "../../engine-adapter";
import { useMapPanel } from "../../map-panel/MapPanelContext";
import {
  dispatchMapSaveRequest,
  MAONO_MAP_SAVE_RESULT_EVENT,
  mapSaveResultFromEvent,
} from "../../map-panel/map-save-events";
import { emitMapPanelTelemetry } from "../../map-panel/map-panel-telemetry";
import {
  isIsochroneAbortError,
  isochroneErrorMessage,
  requestIsochrone,
  type IsochroneMode,
  type IsochroneType,
} from "../../map-panel/isochrone-api";
import IsochroneDialog from "./IsochroneDialog";
import "./map-overlay-controls.css";

type MarkerOrigin = {
  latitude: number;
  longitude: number;
};

type PreviewState = {
  dataId: string;
  label: string;
  canPersist: boolean;
  saveRequestId: string | null;
};

type OverlayMessage = {
  tone: "error" | "success";
  text: string;
};

type OverlayIconName =
  | "focus"
  | "tooltip"
  | "legend"
  | "marker"
  | "isochrone"
  | "trash";

function OverlayIcon({ name }: { name: OverlayIconName }) {
  const icons: Record<OverlayIconName, ReactNode> = {
    focus: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
      </>
    ),
    tooltip: (
      <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z" />
    ),
    legend: (
      <>
        <path d="M9 6h12M9 12h12M9 18h12" />
        <circle cx="4" cy="6" r="1" />
        <circle cx="4" cy="12" r="1" />
        <circle cx="4" cy="18" r="1" />
      </>
    ),
    marker: (
      <>
        <path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" />
        <circle cx="12" cy="10" r="2.5" />
      </>
    ),
    isochrone: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="5" />
        <circle cx="12" cy="12" r="1.5" />
      </>
    ),
    trash: (
      <>
        <path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6" />
        <path d="M10 10v7M14 10v7" />
      </>
    ),
  };

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icons[name]}
    </svg>
  );
}

function modeLabel(mode: IsochroneMode) {
  return {
    drive_traffic: "Carro com trânsito",
    drive: "Carro",
    bicycle: "Bicicleta",
    walk: "Caminhada",
  }[mode];
}

function previewLabel(input: {
  type: IsochroneType;
  mode: IsochroneMode;
  ranges: number[];
}) {
  const unit = input.type === "time" ? "min" : "km";

  return `${modeLabel(input.mode)} · ${input.ranges.join(", ")} ${unit}`;
}

function getCanvas() {
  return document.querySelector(
    ".mapboxgl-canvas",
  ) as HTMLElement | null;
}

function getCanvasRect() {
  return getCanvas()?.getBoundingClientRect() || null;
}

export default function MapOverlayControls() {
  const { projectSlug } = useParams();
  const {
    context,
    customMapOverlayEnabled,
  } = useMapPanel();
  const { commands, state } = useKeplerEngineAdapter();
  const capabilities = context?.capabilities;
  const [tooltipsOpen, setTooltipsOpen] = useState(false);
  const [tooltipDraft, setTooltipDraft] = useState<
    Record<string, string[]>
  >({});
  const [placingMarker, setPlacingMarker] = useState(false);
  const [markerOrigin, setMarkerOrigin] =
    useState<MarkerOrigin | null>(null);
  const [markerMenuOpen, setMarkerMenuOpen] = useState(false);
  const [draggingMarker, setDraggingMarker] = useState(false);
  const [isochroneOpen, setIsochroneOpen] = useState(false);
  const [isochroneBusy, setIsochroneBusy] = useState(false);
  const [isochroneError, setIsochroneError] =
    useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(
    null,
  );
  const [message, setMessage] = useState<OverlayMessage | null>(
    null,
  );
  const [canvasVersion, setCanvasVersion] = useState(0);
  const isochroneRequestRef = useRef<AbortController | null>(null);
  const draggingPointerRef = useRef<number | null>(null);
  const markerMovedRef = useRef(false);
  const previewRef = useRef<PreviewState | null>(null);
  const commandsRef = useRef(commands);

  previewRef.current = preview;
  commandsRef.current = commands;

  useEffect(() => {
    if (!message || message.tone === "error") return undefined;

    const timeoutId = window.setTimeout(
      () => setMessage(null),
      6_000,
    );
    return () => window.clearTimeout(timeoutId);
  }, [message]);

  useEffect(() => {
    const canvas = getCanvas();
    const observer =
      canvas && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() =>
            setCanvasVersion((current) => current + 1),
          )
        : null;
    const updateCanvas = () =>
      setCanvasVersion((current) => current + 1);

    if (canvas && observer) observer.observe(canvas);
    window.addEventListener("resize", updateCanvas);
    window.addEventListener("scroll", updateCanvas, true);
    const animationFrame = window.requestAnimationFrame(updateCanvas);

    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", updateCanvas);
      window.removeEventListener("scroll", updateCanvas, true);
    };
  }, [customMapOverlayEnabled]);

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
        setMarkerOrigin(null);
        setMarkerMenuOpen(false);
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

    window.addEventListener(
      MAONO_MAP_SAVE_RESULT_EVENT,
      handleSaveResult,
    );
    return () =>
      window.removeEventListener(
        MAONO_MAP_SAVE_RESULT_EVENT,
        handleSaveResult,
      );
  }, [
    context?.mode,
    context?.organization?.id,
    context?.project?.id,
  ]);

  useEffect(
    () => () => {
      isochroneRequestRef.current?.abort();
      const current = previewRef.current;

      if (current && !current.saveRequestId) {
        commandsRef.current.removeTransientLayer(current.dataId);
      }
    },
    [],
  );

  const viewport = state.viewport;
  const canvasRect = useMemo(
    () =>
      typeof document === "undefined" ? null : getCanvasRect(),
    [
      canvasVersion,
      viewport?.height,
      viewport?.width,
    ],
  );

  const unproject = useCallback(
    (clientX: number, clientY: number) => {
      if (
        !canvasRect ||
        !viewport ||
        viewport.width <= 0 ||
        viewport.height <= 0
      ) {
        return null;
      }

      const x =
        ((clientX - canvasRect.left) / canvasRect.width) *
        viewport.width;
      const y =
        ((clientY - canvasRect.top) / canvasRect.height) *
        viewport.height;
      const mapViewport = new WebMercatorViewport(viewport);
      const [longitudeRaw, latitude] = mapViewport.unproject([
        x,
        y,
      ]);
      let longitude = longitudeRaw;

      while (longitude > 180) longitude -= 360;
      while (longitude < -180) longitude += 360;

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90
      ) {
        return null;
      }

      return { latitude, longitude };
    },
    [canvasRect, viewport],
  );

  const markerPosition = useMemo(() => {
    if (
      !canvasRect ||
      !markerOrigin ||
      !viewport ||
      viewport.width <= 0 ||
      viewport.height <= 0
    ) {
      return null;
    }

    const mapViewport = new WebMercatorViewport(viewport);
    const [x, y] = mapViewport.project([
      markerOrigin.longitude,
      markerOrigin.latitude,
    ]);

    return {
      left: canvasRect.left + (x / viewport.width) * canvasRect.width,
      top: canvasRect.top + (y / viewport.height) * canvasRect.height,
    };
  }, [canvasRect, markerOrigin, viewport]);

  const filtersActive = state.filters.some(
    (filter) => filter.enabled,
  );
  const focusAvailable = filtersActive
    ? Boolean(state.filteredBounds)
    : Boolean(state.bounds);

  if (
    !customMapOverlayEnabled ||
    typeof document === "undefined"
  ) {
    return null;
  }

  function reportCommand(
    result: KeplerCommandResult<unknown>,
    fallback: string,
  ) {
    if (result.ok) {
      setMessage(null);
      return true;
    }

    setMessage({
      tone: "error",
      text: result.reason || fallback,
    });
    return false;
  }

  function focusVisibleData() {
    const result = filtersActive
      ? commands.fitFilteredData()
      : commands.fitVisibleData();

    reportCommand(
      result,
      "Não foi possível enquadrar os dados visíveis.",
    );
  }

  function openTooltipEditor() {
    if (!capabilities?.configureTooltips) return;

    const nextDraft: Record<string, string[]> = {};

    state.datasets.forEach((dataset) => {
      nextDraft[dataset.id] = (
        state.tooltip.fieldsByDataset[dataset.id] || []
      ).map((field) => field.name);
    });

    setTooltipDraft(nextDraft);
    setTooltipsOpen(true);
  }

  function toggleTooltipField(
    datasetId: string,
    fieldName: string,
  ) {
    setTooltipDraft((current) => {
      const currentFields = current[datasetId] || [];
      const nextFields = currentFields.includes(fieldName)
        ? currentFields.filter((field) => field !== fieldName)
        : [...currentFields, fieldName];

      return {
        ...current,
        [datasetId]: nextFields,
      };
    });
  }

  function saveTooltipConfiguration() {
    if (
      reportCommand(
        commands.setTooltipFields(tooltipDraft),
        "Não foi possível atualizar os tooltips.",
      )
    ) {
      setTooltipsOpen(false);
    }
  }

  function resetMarker() {
    setPlacingMarker(false);
    setMarkerOrigin(null);
    setMarkerMenuOpen(false);
    setIsochroneOpen(false);
    setIsochroneError(null);
  }

  function discardPreview() {
    if (!preview || preview.saveRequestId) return;

    if (
      reportCommand(
        commands.removeTransientLayer(preview.dataId),
        "Não foi possível descartar a prévia.",
      )
    ) {
      emitMapPanelTelemetry("map_isochrone_discarded", {
        mode: context?.mode ?? null,
        projectId: context?.project?.id ?? null,
        organizationId: context?.organization?.id ?? null,
        source: "map-overlay",
      });
      setPreview(null);
      resetMarker();
    }
  }

  function persistPreview() {
    if (
      !preview ||
      preview.saveRequestId ||
      !preview.canPersist ||
      !capabilities?.persistIsochrone
    ) {
      return;
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
  }

  async function createIsochrone(input: {
    type: IsochroneType;
    mode: IsochroneMode;
    ranges: number[];
  }) {
    if (
      isochroneBusy ||
      !markerOrigin ||
      !capabilities?.previewIsochrone
    ) {
      return;
    }

    isochroneRequestRef.current?.abort();
    const controller = new AbortController();
    isochroneRequestRef.current = controller;
    setIsochroneBusy(true);
    setIsochroneError(null);
    setMessage(null);
    emitMapPanelTelemetry("map_isochrone_requested", {
      mode: context?.mode ?? null,
      projectId: context?.project?.id ?? null,
      organizationId: context?.organization?.id ?? null,
      source: "map-overlay",
    });

    try {
      const result = await requestIsochrone(
        {
          projectSlug: projectSlug || null,
          origin: markerOrigin,
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
      setIsochroneOpen(false);
      setMarkerMenuOpen(false);
      emitMapPanelTelemetry("map_isochrone_previewed", {
        mode: context?.mode ?? null,
        projectId: context?.project?.id ?? null,
        organizationId: context?.organization?.id ?? null,
        source: "map-overlay",
      });
    } catch (error) {
      if (isIsochroneAbortError(error)) return;

      const text = isochroneErrorMessage(error);
      setIsochroneError(text);
      emitMapPanelTelemetry("map_isochrone_failed", {
        mode: context?.mode ?? null,
        projectId: context?.project?.id ?? null,
        organizationId: context?.organization?.id ?? null,
        source: "map-overlay",
        code:
          error && typeof error === "object" && "code" in error
            ? String(error.code)
            : "ISOCHRONE_CLIENT_ERROR",
      });
    } finally {
      if (isochroneRequestRef.current === controller) {
        isochroneRequestRef.current = null;
      }
      setIsochroneBusy(false);
    }
  }

  function nudgeMarker(
    horizontalPixels: number,
    verticalPixels: number,
  ) {
    if (!markerOrigin || !viewport) return;

    const mapViewport = new WebMercatorViewport(viewport);
    const [x, y] = mapViewport.project([
      markerOrigin.longitude,
      markerOrigin.latitude,
    ]);
    const [longitudeRaw, latitude] = mapViewport.unproject([
      x + horizontalPixels,
      y + verticalPixels,
    ]);
    let longitude = longitudeRaw;

    while (longitude > 180) longitude -= 360;
    while (longitude < -180) longitude += 360;

    if (
      Number.isFinite(latitude) &&
      Number.isFinite(longitude) &&
      latitude >= -90 &&
      latitude <= 90
    ) {
      setMarkerOrigin({ latitude, longitude });
    }
  }

  return createPortal(
    <>
      <div
        className="maono-map-attribution"
        data-maono-no-preview="true"
      >
        <span>© maõno</span>
        <span aria-hidden="true">|</span>
        <span>Mapa interativo</span>
      </div>

      {placingMarker && canvasRect ? (
        <button
          type="button"
          className="maono-marker-placement"
          style={{
            left: canvasRect.left,
            top: canvasRect.top,
            width: canvasRect.width,
            height: canvasRect.height,
          }}
          onClick={(event) => {
            const origin = unproject(
              event.clientX,
              event.clientY,
            );

            if (origin) {
              setMarkerOrigin(origin);
              setPlacingMarker(false);
              setMarkerMenuOpen(true);
            }
          }}
          aria-label="Clique no mapa para definir a origem da análise"
          data-maono-no-preview="true"
        />
      ) : null}

      {markerOrigin && markerPosition && !preview ? (
        <div
          className="maono-map-marker"
          style={markerPosition}
          data-maono-no-preview="true"
        >
          <button
            type="button"
            className={draggingMarker ? "is-dragging" : ""}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              draggingPointerRef.current = event.pointerId;
              markerMovedRef.current = false;
              setDraggingMarker(true);
            }}
            onPointerMove={(event) => {
              if (draggingPointerRef.current !== event.pointerId) {
                return;
              }
              const origin = unproject(
                event.clientX,
                event.clientY,
              );
              if (origin) {
                markerMovedRef.current = true;
                setMarkerOrigin(origin);
              }
            }}
            onPointerUp={(event) => {
              if (
                event.currentTarget.hasPointerCapture(event.pointerId)
              ) {
                event.currentTarget.releasePointerCapture(
                  event.pointerId,
                );
              }
              draggingPointerRef.current = null;
              setDraggingMarker(false);
              setMarkerMenuOpen(true);
            }}
            onPointerCancel={() => {
              draggingPointerRef.current = null;
              setDraggingMarker(false);
            }}
            onClick={() => {
              if (markerMovedRef.current) {
                markerMovedRef.current = false;
                return;
              }
              setMarkerMenuOpen((current) => !current);
            }}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 30 : 10;
              const movements: Record<
                string,
                [number, number]
              > = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              };
              const movement = movements[event.key];

              if (movement) {
                event.preventDefault();
                nudgeMarker(...movement);
              } else if (
                event.key === "Delete" ||
                event.key === "Backspace"
              ) {
                event.preventDefault();
                resetMarker();
              }
            }}
            title="Arraste ou use as setas para mover a origem"
            aria-label="Origem da isócrona; arraste ou use as setas para mover"
            aria-expanded={markerMenuOpen}
          >
            <OverlayIcon name="marker" />
          </button>
          <span>Origem</span>

          {markerMenuOpen ? (
            <div className="maono-map-marker__menu">
              {capabilities?.previewIsochrone ? (
                <button
                  type="button"
                  onClick={() => {
                    setIsochroneError(null);
                    setIsochroneOpen(true);
                    setMarkerMenuOpen(false);
                  }}
                >
                  <OverlayIcon name="isochrone" />
                  Criar isócronas
                </button>
              ) : null}
              <button type="button" onClick={resetMarker}>
                <OverlayIcon name="trash" />
                Remover marcador
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className="maono-map-overlay"
        data-maono-no-preview="true"
      >
        {message ? (
          <div
            className={`maono-map-overlay__message is-${message.tone}`}
            role={message.tone === "error" ? "alert" : "status"}
          >
            <span>{message.text}</span>
            <button
              type="button"
              onClick={() => setMessage(null)}
              aria-label="Fechar mensagem"
            >
              ×
            </button>
          </div>
        ) : null}

        {tooltipsOpen ? (
          <section
            className="maono-tooltip-editor"
            aria-label="Configuração de tooltips"
          >
            <header>
              <div>
                <span>Interação do mapa</span>
                <strong>Campos dos tooltips</strong>
              </div>
              <button
                type="button"
                onClick={() => setTooltipsOpen(false)}
                aria-label="Fechar configuração de tooltips"
              >
                ×
              </button>
            </header>
            <div className="maono-tooltip-editor__content">
              {state.datasets.length ? (
                state.datasets.map((dataset) => (
                  <fieldset key={dataset.id}>
                    <legend>{dataset.label}</legend>
                    {dataset.fields.map((field) => (
                      <label key={field.name}>
                        <input
                          type="checkbox"
                          checked={Boolean(
                            tooltipDraft[dataset.id]?.includes(
                              field.name,
                            ),
                          )}
                          onChange={() =>
                            toggleTooltipField(
                              dataset.id,
                              field.name,
                            )
                          }
                        />
                        <span>{field.name}</span>
                      </label>
                    ))}
                  </fieldset>
                ))
              ) : (
                <p>Nenhum campo disponível.</p>
              )}
            </div>
            <footer>
              <button
                type="button"
                onClick={() => setTooltipsOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={saveTooltipConfiguration}
              >
                Aplicar
              </button>
            </footer>
          </section>
        ) : null}

        {preview ? (
          <section className="maono-isochrone-preview">
            <div>
              <OverlayIcon name="isochrone" />
              <span>
                <small>
                  {preview.saveRequestId
                    ? "Salvamento em andamento"
                    : "Prévia temporária"}
                </small>
                <strong>{preview.label}</strong>
                {!preview.canPersist ? (
                  <em>
                    Este modo permite consultar e descartar, mas não
                    salvar a análise.
                  </em>
                ) : null}
              </span>
            </div>
            <div>
              {preview.canPersist &&
              capabilities?.persistIsochrone ? (
                <button
                  type="button"
                  className="is-primary"
                  onClick={persistPreview}
                  disabled={Boolean(preview.saveRequestId)}
                >
                  {preview.saveRequestId
                    ? "Salvando…"
                    : "Salvar no projeto"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={discardPreview}
                disabled={Boolean(preview.saveRequestId)}
              >
                Descartar
              </button>
            </div>
          </section>
        ) : null}

        <div className="maono-map-overlay__buttons">
          {capabilities?.focusMapData ? (
            <button
              type="button"
              onClick={focusVisibleData}
              disabled={!focusAvailable}
              title="Centralizar nos dados visíveis"
              aria-label="Centralizar nos dados visíveis"
            >
              <OverlayIcon name="focus" />
            </button>
          ) : null}

          {capabilities?.configureTooltips ? (
            <button
              type="button"
              className={tooltipsOpen ? "is-active" : ""}
              onClick={
                tooltipsOpen
                  ? () => setTooltipsOpen(false)
                  : openTooltipEditor
              }
              title="Configurar tooltips"
              aria-label="Configurar tooltips"
              aria-expanded={tooltipsOpen}
            >
              <OverlayIcon name="tooltip" />
            </button>
          ) : null}

          {capabilities?.toggleLegend ? (
            <button
              type="button"
              className={state.legendVisible ? "is-active" : ""}
              onClick={() =>
                reportCommand(
                  commands.toggleLegend(),
                  "Não foi possível alterar a legenda.",
                )
              }
              title="Mostrar ou ocultar legenda"
              aria-label="Mostrar ou ocultar legenda"
              aria-pressed={state.legendVisible}
            >
              <OverlayIcon name="legend" />
            </button>
          ) : null}

          {capabilities?.previewIsochrone && !preview ? (
            <button
              type="button"
              className={placingMarker ? "is-active" : ""}
              onClick={() => {
                if (placingMarker) {
                  resetMarker();
                } else {
                  setMarkerOrigin(null);
                  setMarkerMenuOpen(false);
                  setPlacingMarker(true);
                }
              }}
              title={
                placingMarker
                  ? "Cancelar inserção de marcador"
                  : "Inserir marcador para análise"
              }
              aria-label={
                placingMarker
                  ? "Cancelar inserção de marcador"
                  : "Inserir marcador para análise"
              }
              aria-pressed={placingMarker}
            >
              <OverlayIcon name="marker" />
            </button>
          ) : null}
        </div>
      </div>

      <IsochroneDialog
        open={isochroneOpen}
        busy={isochroneBusy}
        error={isochroneError}
        onClose={() => {
          if (!isochroneBusy) {
            setIsochroneOpen(false);
            setIsochroneError(null);
          }
        }}
        onSubmit={(input) => void createIsochrone(input)}
      />
    </>,
    document.body,
  );
}
