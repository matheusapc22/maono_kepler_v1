import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import type { Feature } from "@kepler.gl/types";

import {
  useKeplerEngineAdapter,
  type KeplerCommandResult,
} from "../../engine-adapter";
import { useMapPanel } from "../../map-panel/MapPanelContext";
import AnalysisToolMenu from "./analysis-tools/AnalysisToolMenu";
import { useMapToolController } from "./analysis-tools/useMapToolController";
import BufferDialog from "./BufferDialog";
import GeometryFilterMenu from "./GeometryFilterMenu";
import IsochroneDialog from "./IsochroneDialog";
import MarkerContextMenu from "./MarkerContextMenu";
import { useBufferPreview } from "./useBufferPreview";
import { useGeometryFilterDrawing } from "./useGeometryFilterDrawing";
import { useGeometryFilterManager } from "./useGeometryFilterManager";
import { useIsochronePreview } from "./useIsochronePreview";
import { useMapMarker } from "./useMapMarker";
import "./map-overlay-controls.css";
import "./map-placement-mode.css";
import "./geometry-filter-ui.css";

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
  | "buffer"
  | "geometry";

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
    buffer: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="1.6" />
        <path d="M12 12l5.5-5.5" />
      </>
    ),
    geometry: (
      <>
        <path d="M5 5 18 4l2 11-8 5-8-6L5 5Z" />
        <circle cx="5" cy="5" r="1.3" />
        <circle cx="18" cy="4" r="1.3" />
        <circle cx="20" cy="15" r="1.3" />
        <circle cx="12" cy="20" r="1.3" />
        <circle cx="4" cy="14" r="1.3" />
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

function activeAnalysisToolLabel(tool: "marker" | "buffer" | "isochrone" | null) {
  if (tool === "buffer") return "buffer";
  if (tool === "isochrone") return "isócrona";
  if (tool === "marker") return "marcador";
  return "análise";
}

function placementPrompt(tool: "marker" | "buffer" | "isochrone" | null) {
  if (tool === "buffer") return "Clique no mapa para definir a origem do buffer";
  if (tool === "isochrone") return "Clique no mapa para definir a origem da isócrona";
  return "Clique no mapa para adicionar o marcador";
}

export default function MapOverlayControls() {
  const { context, customMapOverlayEnabled } = useMapPanel();
  const { commands, state } = useKeplerEngineAdapter();
  const capabilities = context?.capabilities;
  const [tooltipsOpen, setTooltipsOpen] = useState(false);
  const [tooltipDraft, setTooltipDraft] = useState<Record<string, string[]>>({});
  const [commandMessage, setCommandMessage] = useState<OverlayMessage | null>(null);
  const [drawnFilterFeature, setDrawnFilterFeature] = useState<Feature | null>(null);
  const handledBufferPreviewRef = useRef<string | null>(null);
  const marker = useMapMarker(state.viewport);
  const geometryDraw = useGeometryFilterDrawing(state.viewport, marker.canvasRect);
  const toolController = useMapToolController({
    startPlacement: marker.startPlacement,
    cancelPlacement: marker.cancelPlacement,
    resetMarker: marker.reset,
  });

  useGeometryFilterManager({
    enabled:
      customMapOverlayEnabled &&
      toolController.state.mode !== "placingPoint" &&
      !marker.placing &&
      !geometryDraw.active,
  });

  const analysisPendingPoint = toolController.pendingPoint;
  const isochrone = useIsochronePreview({
    pendingPoint: analysisPendingPoint,
    onMarkerReset: marker.reset,
  });
  const buffer = useBufferPreview({
    pendingPoint: analysisPendingPoint,
    session: toolController.multiBufferSession,
    onMarkerReset: marker.reset,
  });
  const filtersActive = state.filters.some((filter) => filter.enabled);
  const focusAvailable = filtersActive ? Boolean(state.filteredBounds) : Boolean(state.bounds);
  const message = commandMessage || buffer.message || isochrone.message;
  const isochroneCapabilityEnabled = capabilities?.previewIsochrone === true;
  const bufferCapabilityEnabled = capabilities?.previewBuffer === true;
  const analysisMarkerCapabilityEnabled = capabilities?.placeAnalysisMarker === true;
  const geometryFilterCapabilityEnabled = capabilities?.editFilters === true;
  const analysisLauncherEnabled = Boolean(
    analysisMarkerCapabilityEnabled ||
      bufferCapabilityEnabled ||
      isochroneCapabilityEnabled ||
      geometryFilterCapabilityEnabled,
  );
  const analysisPreviewActive = Boolean(
    isochrone.preview || (buffer.preview && !toolController.multiBufferActive),
  );
  const selectingToolState =
    toolController.state.mode === "selectingTool" ? toolController.state : null;
  const placementModeActive = toolController.state.mode === "placingPoint";
  const placementTool = placementModeActive
    ? toolController.state.tool
    : marker.placementKind ?? "marker";
  const activeToolLabel = activeAnalysisToolLabel(toolController.state.tool);
  const placementLabel = placementPrompt(placementTool);
  const analysisButtonLabel = geometryDraw.active
    ? "Sair do desenho de filtro"
    : toolController.menuOpen
      ? "Fechar menu de análise"
      : placementModeActive
        ? `Sair do modo pin de ${activeToolLabel}`
        : "Adicionar análise";
  const launcherVisible =
    !analysisPreviewActive &&
    !toolController.multiBufferActive &&
    toolController.state.mode !== "configuring" &&
    toolController.state.mode !== "reviewing";
  const geometryPointString = geometryDraw.screenPoints
    .map((point) => `${point.x},${point.y}`)
    .join(" ");

  useEffect(() => {
    if (!toolController.pendingPoint) return;

    if (
      toolController.configurationTarget === "buffer" &&
      !buffer.dialogOpen &&
      (!buffer.preview || toolController.multiBufferActive)
    ) {
      buffer.openDialog();
      return;
    }

    if (
      toolController.configurationTarget === "isochrone" &&
      !isochrone.dialogOpen &&
      !isochrone.preview
    ) {
      isochrone.openDialog();
    }
  }, [
    buffer.dialogOpen,
    buffer.openDialog,
    buffer.preview,
    isochrone.dialogOpen,
    isochrone.openDialog,
    isochrone.preview,
    toolController.configurationTarget,
    toolController.multiBufferActive,
    toolController.pendingPoint,
  ]);

  useEffect(() => {
    if (!buffer.preview) {
      handledBufferPreviewRef.current = null;
      return;
    }

    const previewKey = [
      buffer.preview.dataId,
      buffer.preview.itemCount,
      buffer.preview.featureCount,
    ].join(":");

    if (handledBufferPreviewRef.current === previewKey) return;

    if (
      toolController.state.mode === "configuring" &&
      toolController.state.tool === "buffer" &&
      toolController.state.configurationStatus === "submitting" &&
      !buffer.busy &&
      !buffer.error
    ) {
      const accepted = toolController.analysisCreated({
        kind: "buffer",
        dataId: buffer.preview.dataId,
      });
      if (accepted) handledBufferPreviewRef.current = previewKey;
    }
  }, [buffer.busy, buffer.error, buffer.preview, toolController]);

  useEffect(() => {
    if (
      isochrone.preview &&
      toolController.state.mode === "configuring" &&
      toolController.state.tool === "isochrone"
    ) {
      toolController.analysisCreated({
        kind: "isochrone",
        dataId: isochrone.preview.dataId,
      });
    }
  }, [isochrone.preview, toolController]);

  if (!customMapOverlayEnabled || typeof document === "undefined") {
    return null;
  }

  function clearMessage() {
    setCommandMessage(null);
    buffer.setMessage(null);
    isochrone.setMessage(null);
  }

  function reportCommand(result: KeplerCommandResult<unknown>, fallback: string) {
    if (result.ok) {
      setCommandMessage(null);
      return true;
    }

    setCommandMessage({
      tone: "error",
      text: result.reason || fallback,
    });
    return false;
  }

  function focusVisibleData() {
    const result = filtersActive ? commands.fitFilteredData() : commands.fitVisibleData();
    reportCommand(result, "Não foi possível enquadrar os dados visíveis.");
  }

  function openTooltipEditor() {
    if (!capabilities?.configureTooltips) return;

    const nextDraft: Record<string, string[]> = {};
    state.datasets.forEach((dataset) => {
      nextDraft[dataset.id] = (state.tooltip.fieldsByDataset[dataset.id] || []).map(
        (field) => field.name,
      );
    });

    setTooltipDraft(nextDraft);
    setTooltipsOpen(true);
  }

  function toggleTooltipField(datasetId: string, fieldName: string) {
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

  function closeBufferConfiguration() {
    if (buffer.busy) return;
    buffer.closeDialog();
    toolController.cancelPendingPoint();
  }

  function closeIsochroneConfiguration() {
    if (isochrone.busy) return;
    isochrone.closeDialog();
    toolController.cancelPendingPoint();
  }

  function submitBufferConfiguration(input: Parameters<typeof buffer.generate>[0]) {
    if (!toolController.submitConfiguration()) return;
    void buffer.generate(input);
  }

  function submitIsochroneConfiguration(input: Parameters<typeof isochrone.generate>[0]) {
    if (!toolController.submitConfiguration()) return;
    void isochrone.generate(input);
  }

  function keepBuffer() {
    if (buffer.keep()) toolController.finishAnalysis();
  }

  function discardBuffer() {
    if (buffer.discard()) toolController.finishAnalysis();
  }

  function keepIsochrone() {
    if (isochrone.keep()) toolController.finishAnalysis();
  }

  function discardIsochrone() {
    if (isochrone.discard()) toolController.finishAnalysis();
  }

  function startGeometryFilterDraw() {
    if (!geometryFilterCapabilityEnabled) return;
    clearMessage();
    setDrawnFilterFeature(null);
    toolController.cancelTool();
    marker.reset();
    geometryDraw.start();
  }

  function finishGeometryFilterDraw() {
    const feature = geometryDraw.finish();
    if (!feature) {
      setCommandMessage({
        tone: "error",
        text: "Defina pelo menos três pontos para concluir o polígono de filtragem.",
      });
      return;
    }

    setCommandMessage(null);
    setDrawnFilterFeature(feature);
  }

  function cancelGeometryFilterDraw() {
    geometryDraw.cancel();
    setCommandMessage(null);
  }

  return createPortal(
    <>
      <div className="maono-map-attribution" data-maono-no-preview="true">
        <span>© maõno</span>
        <span aria-hidden="true">|</span>
        <span>Mapa interativo</span>
      </div>

      {marker.placing && marker.canvasRect ? (
        <button
          type="button"
          className="maono-marker-placement"
          style={{
            left: marker.canvasRect.left,
            top: marker.canvasRect.top,
            width: marker.canvasRect.width,
            height: marker.canvasRect.height,
          }}
          onClick={(event) => {
            const point = marker.placeAt(event.clientX, event.clientY);
            if (point) toolController.pointPlaced(point);
          }}
          aria-label={placementLabel}
          data-placement-label={placementLabel}
          data-analysis-tool={placementTool}
          data-maono-no-preview="true"
        />
      ) : null}

      {geometryDraw.active && marker.canvasRect ? (
        <svg
          className="maono-geometry-draw-canvas"
          style={{
            left: marker.canvasRect.left,
            top: marker.canvasRect.top,
            width: marker.canvasRect.width,
            height: marker.canvasRect.height,
          }}
          viewBox={`0 0 ${marker.canvasRect.width} ${marker.canvasRect.height}`}
          aria-hidden="true"
        >
          {geometryDraw.screenPoints.length >= 3 ? (
            <polygon points={geometryPointString} />
          ) : geometryDraw.screenPoints.length >= 2 ? (
            <polyline points={geometryPointString} />
          ) : null}
          {geometryDraw.screenPoints.map((point, index) => (
            <circle
              key={`${point.x}-${point.y}-${index}`}
              cx={point.x}
              cy={point.y}
              r="4"
            />
          ))}
        </svg>
      ) : null}

      {marker.origin && marker.position && !analysisPreviewActive ? (
        <div
          className="maono-map-marker"
          style={marker.position}
          data-maono-no-preview="true"
        >
          <button
            type="button"
            className={marker.dragging ? "is-dragging" : ""}
            onPointerDown={marker.beginDrag}
            onPointerMove={marker.moveDrag}
            onPointerUp={marker.endDrag}
            onPointerCancel={marker.cancelDrag}
            onClick={marker.toggleMenuFromClick}
            onKeyDown={marker.handleMarkerKeyDown}
            title="Arraste ou use as setas para mover o marcador"
            aria-label="Marcador; arraste ou use as setas para mover"
            aria-expanded={marker.menuOpen}
          >
            <OverlayIcon name="marker" />
          </button>
          <span>Origem</span>

          <MarkerContextMenu
            open={marker.menuOpen}
            onClose={() => marker.setMenuOpen(false)}
            onRemove={marker.reset}
          />
        </div>
      ) : null}

      <div className="maono-map-overlay" data-maono-no-preview="true">
        {message ? (
          <div
            className={`maono-map-overlay__message is-${message.tone}`}
            role={message.tone === "error" ? "alert" : "status"}
          >
            <span>{message.text}</span>
            <button type="button" onClick={clearMessage} aria-label="Fechar mensagem">
              ×
            </button>
          </div>
        ) : null}

        {geometryDraw.active ? (
          <section
            className="maono-geometry-draw-mode"
            aria-label="Desenho de polígono de filtragem ativo"
          >
            <div className="maono-geometry-draw-mode__copy">
              <small>Filtro por geometria</small>
              <strong>Desenhe o polígono no mapa</strong>
              <span>
                Clique para adicionar vértices. Arraste o mapa normalmente para navegar.
                Use Backspace para desfazer ou Esc para cancelar.
              </span>
            </div>
            <div className="maono-geometry-draw-mode__actions">
              <button
                type="button"
                onClick={geometryDraw.undo}
                disabled={!geometryDraw.points.length}
              >
                Desfazer
              </button>
              <button type="button" onClick={cancelGeometryFilterDraw}>
                Cancelar
              </button>
              <button
                type="button"
                className="is-primary"
                onClick={finishGeometryFilterDraw}
                disabled={!geometryDraw.canFinish}
              >
                Concluir polígono
              </button>
            </div>
          </section>
        ) : null}

        {drawnFilterFeature ? (
          <section
            className="maono-drawn-filter-panel"
            aria-label="Configurar polígono de filtragem desenhado"
          >
            <header className="maono-drawn-filter-panel__header">
              <span>
                <small>Filtro por geometria</small>
                <strong>Área desenhada</strong>
              </span>
              <button
                type="button"
                onClick={() => setDrawnFilterFeature(null)}
                aria-label="Fechar configuração do polígono desenhado"
              >
                ×
              </button>
            </header>
            <div className="maono-drawn-filter-panel__body">
              <GeometryFilterMenu
                feature={drawnFilterFeature}
                title="Escolha as camadas filtradas"
                description="O polígono desenhado será aplicado somente às camadas selecionadas abaixo."
              />
            </div>
          </section>
        ) : null}

        {placementModeActive ? (
          <section className="maono-placement-mode" aria-label="Modo pin ativo">
            <div className="maono-placement-mode__copy">
              <small>Modo pin ativo</small>
              <strong>{placementLabel}</strong>
            </div>
            <div className="maono-placement-mode__actions">
              <kbd>Esc</kbd>
              <button type="button" onClick={toolController.exitPlacement}>
                Sair do modo pin
              </button>
            </div>
          </section>
        ) : null}

        {selectingToolState ? (
          <AnalysisToolMenu
            state={selectingToolState}
            canBuffer={bufferCapabilityEnabled}
            canIsochrone={isochroneCapabilityEnabled}
            canGeometryFilter={geometryFilterCapabilityEnabled}
            canPlaceMarker={analysisMarkerCapabilityEnabled}
            onSelectTool={toolController.selectTool}
            onSelectBufferMode={toolController.selectBufferMode}
            onStartPlacement={toolController.startSelectedPlacement}
            onStartMarkerPlacement={toolController.startMarkerPlacement}
            onStartGeometryFilterDraw={startGeometryFilterDraw}
            onCancel={toolController.cancelTool}
          />
        ) : null}

        {toolController.canFinishMulti ? (
          <section
            className="maono-isochrone-preview maono-multibuffer-session"
            aria-label="Sessão de Buffer ativa"
          >
            <div>
              <OverlayIcon name="buffer" />
              <span>
                <small>Buffer ativo</small>
                <strong>{buffer.preview?.label || "Adicione a próxima origem"}</strong>
              </span>
            </div>
            <div>
              <button type="button" className="is-primary" onClick={toolController.finishMulti}>
                Finalizar Buffer
              </button>
            </div>
          </section>
        ) : null}

        {tooltipsOpen ? (
          <section className="maono-tooltip-editor" aria-label="Configuração de tooltips">
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
                          checked={Boolean(tooltipDraft[dataset.id]?.includes(field.name))}
                          onChange={() => toggleTooltipField(dataset.id, field.name)}
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
              <button type="button" onClick={() => setTooltipsOpen(false)}>
                Cancelar
              </button>
              <button type="button" className="is-primary" onClick={saveTooltipConfiguration}>
                Aplicar
              </button>
            </footer>
          </section>
        ) : null}

        {isochrone.preview ? (
          <section className="maono-isochrone-preview">
            <div>
              <OverlayIcon name="isochrone" />
              <span>
                <small>Prévia temporária</small>
                <strong>{isochrone.preview.label}</strong>
                {!capabilities?.persistIsochrone ? (
                  <em>Este modo permite consultar e descartar, mas não manter a análise.</em>
                ) : null}
              </span>
            </div>
            <div>
              {capabilities?.persistIsochrone ? (
                <button type="button" className="is-primary" onClick={keepIsochrone}>
                  Manter
                </button>
              ) : null}
              <button type="button" onClick={discardIsochrone}>
                Descartar
              </button>
            </div>
          </section>
        ) : null}

        {buffer.preview && !toolController.multiBufferActive ? (
          <section className="maono-isochrone-preview maono-buffer-preview">
            <div>
              <OverlayIcon name="buffer" />
              <span>
                <small>Prévia temporária</small>
                <strong>{buffer.preview.label}</strong>
                {!capabilities?.persistBuffer ? (
                  <em>Este modo permite consultar e descartar, mas não manter a análise.</em>
                ) : null}
              </span>
            </div>
            <div>
              {capabilities?.persistBuffer ? (
                <button type="button" className="is-primary" onClick={keepBuffer}>
                  Manter
                </button>
              ) : null}
              <button type="button" onClick={discardBuffer}>
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
              onClick={tooltipsOpen ? () => setTooltipsOpen(false) : openTooltipEditor}
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
                reportCommand(commands.toggleLegend(), "Não foi possível alterar a legenda.")
              }
              title="Mostrar ou ocultar legenda"
              aria-label="Mostrar ou ocultar legenda"
              aria-pressed={state.legendVisible}
            >
              <OverlayIcon name="legend" />
            </button>
          ) : null}

          {launcherVisible ? (
            <button
              type="button"
              className={toolController.active || geometryDraw.active ? "is-active" : ""}
              disabled={!analysisLauncherEnabled}
              onClick={
                geometryDraw.active
                  ? cancelGeometryFilterDraw
                  : placementModeActive
                    ? toolController.exitPlacement
                    : toolController.toggleToolMenu
              }
              title={analysisButtonLabel}
              aria-label={analysisButtonLabel}
              aria-haspopup="menu"
              aria-expanded={toolController.menuOpen}
              aria-pressed={toolController.active || geometryDraw.active}
              data-active-analysis-tool={
                geometryDraw.active
                  ? "geometry-filter"
                  : toolController.state.tool ?? "none"
              }
              data-analysis-marker-state={
                analysisMarkerCapabilityEnabled ? "ENABLED" : "DISABLED"
              }
              data-isochrone-state={context?.isochroneFeatureState?.reason || "UNKNOWN"}
            >
              <OverlayIcon name={geometryDraw.active ? "geometry" : "marker"} />
            </button>
          ) : null}
        </div>
      </div>

      <IsochroneDialog
        open={isochrone.dialogOpen}
        busy={isochrone.busy}
        error={isochrone.error}
        onClose={closeIsochroneConfiguration}
        onSubmit={submitIsochroneConfiguration}
      />

      <BufferDialog
        open={buffer.dialogOpen}
        busy={buffer.busy}
        error={buffer.error}
        onClose={closeBufferConfiguration}
        onSubmit={submitBufferConfiguration}
      />
    </>,
    document.body,
  );
}
