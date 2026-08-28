import { type ReactNode, useState } from "react";
import { createPortal } from "react-dom";

import {
  useKeplerEngineAdapter,
  type KeplerCommandResult,
} from "../../engine-adapter";
import { useMapPanel } from "../../map-panel/MapPanelContext";
import { describeIsochroneAvailability } from "../../map-panel/isochrone-feature-diagnostic";
import BufferDialog from "./BufferDialog";
import IsochroneDialog from "./IsochroneDialog";
import { useBufferPreview } from "./useBufferPreview";
import { useIsochronePreview } from "./useIsochronePreview";
import { useMapMarker } from "./useMapMarker";
import "./map-overlay-controls.css";

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
    buffer: (
      <>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="1.6" />
        <path d="M12 12l5.5-5.5" />
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

export default function MapOverlayControls() {
  const { context, customMapOverlayEnabled } = useMapPanel();
  const { commands, state } = useKeplerEngineAdapter();
  const capabilities = context?.capabilities;
  const [tooltipsOpen, setTooltipsOpen] = useState(false);
  const [tooltipDraft, setTooltipDraft] = useState<
    Record<string, string[]>
  >({});
  const [commandMessage, setCommandMessage] =
    useState<OverlayMessage | null>(null);
  const marker = useMapMarker(state.viewport);
  const isochrone = useIsochronePreview({
    origin: marker.origin,
    onMarkerReset: marker.reset,
  });
  const buffer = useBufferPreview({
    origin: marker.origin,
    onMarkerReset: marker.reset,
  });
  const filtersActive = state.filters.some((filter) => filter.enabled);
  const focusAvailable = filtersActive
    ? Boolean(state.filteredBounds)
    : Boolean(state.bounds);
  const message = commandMessage || buffer.message || isochrone.message;
  const isochroneCapabilityEnabled = capabilities?.previewIsochrone === true;
  const bufferCapabilityEnabled = capabilities?.previewBuffer === true;
  const analysisMarkerCapabilityEnabled =
    capabilities?.placeAnalysisMarker === true;
  const analysisPreviewActive = Boolean(isochrone.preview || buffer.preview);
  const isochroneAvailabilityLabel = describeIsochroneAvailability(
    context?.isochroneFeatureState,
    isochroneCapabilityEnabled,
  );
  const analysisMarkerAvailabilityLabel = analysisMarkerCapabilityEnabled
    ? "Posicionar origem da análise"
    : isochroneAvailabilityLabel;

  if (!customMapOverlayEnabled || typeof document === "undefined") {
    return null;
  }

  function clearMessage() {
    setCommandMessage(null);
    buffer.setMessage(null);
    isochrone.setMessage(null);
  }

  function reportCommand(
    result: KeplerCommandResult<unknown>,
    fallback: string,
  ) {
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
          onClick={(event) => marker.placeAt(event.clientX, event.clientY)}
          aria-label="Clique no mapa para definir a origem da análise"
          data-maono-no-preview="true"
        />
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
            title="Arraste ou use as setas para mover a origem da análise"
            aria-label="Origem da análise; arraste ou use as setas para mover"
            aria-expanded={marker.menuOpen}
          >
            <OverlayIcon name="marker" />
          </button>
          <span>Origem</span>

          {marker.menuOpen ? (
            <div className="maono-map-marker__menu">
              {isochroneCapabilityEnabled ? (
                <button
                  type="button"
                  onClick={() => {
                    isochrone.openDialog();
                    marker.setMenuOpen(false);
                  }}
                >
                  <OverlayIcon name="isochrone" />
                  Criar isócronas
                </button>
              ) : null}
              {bufferCapabilityEnabled ? (
                <button
                  type="button"
                  onClick={() => {
                    buffer.openDialog();
                    marker.setMenuOpen(false);
                  }}
                >
                  <OverlayIcon name="buffer" />
                  Criar buffers
                </button>
              ) : null}
              <button type="button" onClick={marker.reset}>
                <OverlayIcon name="trash" />
                Remover marcador
              </button>
            </div>
          ) : null}
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
                <button
                  type="button"
                  className="is-primary"
                  onClick={isochrone.keep}
                >
                  Manter
                </button>
              ) : null}
              <button type="button" onClick={isochrone.discard}>
                Descartar
              </button>
            </div>
          </section>
        ) : null}

        {buffer.preview ? (
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
                <button
                  type="button"
                  className="is-primary"
                  onClick={buffer.keep}
                >
                  Manter
                </button>
              ) : null}
              <button type="button" onClick={buffer.discard}>
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

          {!analysisPreviewActive ? (
            <button
              type="button"
              className={marker.placing ? "is-active" : ""}
              disabled={!analysisMarkerCapabilityEnabled}
              onClick={() => {
                if (!analysisMarkerCapabilityEnabled) return;
                if (marker.placing) {
                  marker.reset();
                } else {
                  marker.startPlacement();
                }
              }}
              title={
                marker.placing
                  ? "Cancelar inserção de marcador"
                  : analysisMarkerAvailabilityLabel
              }
              aria-label={
                marker.placing
                  ? "Cancelar inserção de marcador"
                  : analysisMarkerAvailabilityLabel
              }
              aria-pressed={marker.placing}
              data-analysis-marker-state={
                analysisMarkerCapabilityEnabled ? "ENABLED" : "DISABLED"
              }
              data-isochrone-state={context?.isochroneFeatureState?.reason || "UNKNOWN"}
            >
              <OverlayIcon name="marker" />
            </button>
          ) : null}
        </div>
      </div>

      <IsochroneDialog
        open={isochrone.dialogOpen}
        busy={isochrone.busy}
        error={isochrone.error}
        onClose={isochrone.closeDialog}
        onSubmit={(input) => void isochrone.generate(input)}
      />

      <BufferDialog
        open={buffer.dialogOpen}
        busy={buffer.busy}
        error={buffer.error}
        onClose={buffer.closeDialog}
        onSubmit={(input) => void buffer.generate(input)}
      />
    </>,
    document.body,
  );
}
