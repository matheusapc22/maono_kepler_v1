import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  useDispatch,
  useSelector,
} from "react-redux";
import { useParams } from "react-router";
import { WebMercatorViewport } from "@deck.gl/core";
import {
  addDataToMap,
  interactionConfigChange,
  removeDataset,
  toggleMapControl,
  updateMap,
  wrapTo,
} from "@kepler.gl/actions";
import { processGeojson } from "@kepler.gl/processors";

import {
  KEPLER_MAP_ID,
  selectKeplerUiState,
  selectKeplerViewportState,
  selectKeplerVisState,
} from "../../integration/keplerBridge";
import { useMapPanel } from "../../map-panel/MapPanelContext";
import {
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

type DatasetView = {
  id: string;
  label: string;
  fields: string[];
  raw: any;
};

type PreviewState = {
  dataId: string;
  label: string;
};

type AddDataToMapConfig = NonNullable<
  Parameters<typeof addDataToMap>[0]["config"]
>;

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

function toArray(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (typeof value?.toArray === "function") return value.toArray();
  return [];
}

function toPlain(value: any) {
  if (typeof value?.toJS === "function") return value.toJS();
  return value;
}

function objectValue(value: any, key: string) {
  if (typeof value?.get === "function") return value.get(key);
  return value?.[key];
}

function datasetViews(datasets: any): DatasetView[] {
  if (!datasets) return [];

  const entries =
    typeof datasets.entrySeq === "function"
      ? datasets.entrySeq().toArray()
      : datasets instanceof Map
        ? Array.from(datasets.entries())
        : Object.entries(datasets);

  return entries.map(([key, raw]: [string, any]) => {
    const fields = toArray(
      objectValue(raw, "fields") ??
        objectValue(objectValue(raw, "data"), "fields"),
    )
      .map((field) =>
        String(objectValue(field, "name") || "").trim(),
      )
      .filter(Boolean);
    const info = objectValue(raw, "info");

    return {
      id: String(objectValue(raw, "id") || key),
      label: String(
        objectValue(raw, "label") ||
          objectValue(info, "label") ||
          key,
      ),
      fields,
      raw,
    };
  });
}

function visitCoordinates(
  coordinates: any,
  bounds: {
    minLatitude: number;
    minLongitude: number;
    maxLatitude: number;
    maxLongitude: number;
  },
) {
  if (
    Array.isArray(coordinates) &&
    typeof coordinates[0] === "number" &&
    typeof coordinates[1] === "number"
  ) {
    const [longitude, latitude] = coordinates;

    if (
      Number.isFinite(longitude) &&
      Number.isFinite(latitude) &&
      longitude >= -180 &&
      longitude <= 180 &&
      latitude >= -90 &&
      latitude <= 90
    ) {
      bounds.minLongitude = Math.min(
        bounds.minLongitude,
        longitude,
      );
      bounds.maxLongitude = Math.max(
        bounds.maxLongitude,
        longitude,
      );
      bounds.minLatitude = Math.min(
        bounds.minLatitude,
        latitude,
      );
      bounds.maxLatitude = Math.max(
        bounds.maxLatitude,
        latitude,
      );
    }

    return;
  }

  if (Array.isArray(coordinates)) {
    coordinates.forEach((item) => visitCoordinates(item, bounds));
  }
}

function datasetRowIndexes(dataset: any) {
  const filteredIndex = objectValue(dataset, "filteredIndex");
  const allIndexes = objectValue(dataset, "allIndexes");
  const filteredIndexes = toArray(filteredIndex);
  const everyIndex = toArray(allIndexes);

  if (filteredIndexes.length) {
    return filteredIndexes;
  }

  if (everyIndex.length) return everyIndex;

  const rows = objectValue(dataset, "allData");
  return toArray(rows).map((_, index) => index);
}

function readCell(dataset: any, rowIndex: number, columnIndex: number) {
  const dataContainer = objectValue(dataset, "dataContainer");

  if (typeof dataContainer?.valueAt === "function") {
    return dataContainer.valueAt(rowIndex, columnIndex);
  }

  const rows = objectValue(dataset, "allData");
  const row =
    typeof rows?.get === "function"
      ? rows.get(rowIndex)
      : rows?.[rowIndex];

  return typeof row?.get === "function"
    ? row.get(columnIndex)
    : row?.[columnIndex];
}

function calculateBounds(
  layersInput: any,
  datasets: DatasetView[],
) {
  const bounds = {
    minLatitude: 90,
    minLongitude: 180,
    maxLatitude: -90,
    maxLongitude: -180,
  };
  const byId = new Map(datasets.map((dataset) => [dataset.id, dataset]));

  for (const layerRaw of toArray(layersInput)) {
    const layer = toPlain(layerRaw) || {};
    const config = toPlain(layer.config) || {};
    const type = String(layer.type || "");

    if (config.isVisible === false) continue;
    if (!["point", "cluster", "heatmap", "geojson"].includes(type)) {
      continue;
    }

    const dataId = Array.isArray(config.dataId)
      ? String(config.dataId[0] || "")
      : String(config.dataId || "");
    const dataset = byId.get(dataId);

    if (!dataset) continue;

    const columns = toPlain(config.columns) || {};
    const indexes = datasetRowIndexes(dataset.raw);

    if (type === "geojson") {
      const geojsonColumn =
        toPlain(columns.geojson)?.value || columns.geojson;
      const columnIndex = dataset.fields.indexOf(geojsonColumn);

      if (columnIndex < 0) continue;

      indexes.forEach((rowIndex) => {
        const raw = readCell(dataset.raw, rowIndex, columnIndex);
        let geometry = raw;

        if (typeof raw === "string") {
          try {
            geometry = JSON.parse(raw);
          } catch {
            geometry = null;
          }
        }

        visitCoordinates(
          geometry?.geometry?.coordinates ??
            geometry?.coordinates ??
            geometry,
          bounds,
        );
      });
      continue;
    }

    const latitudeField =
      toPlain(columns.lat)?.value || columns.lat;
    const longitudeField =
      toPlain(columns.lng)?.value || columns.lng;
    const latitudeIndex = dataset.fields.indexOf(latitudeField);
    const longitudeIndex = dataset.fields.indexOf(longitudeField);

    if (latitudeIndex < 0 || longitudeIndex < 0) continue;

    indexes.forEach((rowIndex) => {
      visitCoordinates(
        [
          Number(readCell(dataset.raw, rowIndex, longitudeIndex)),
          Number(readCell(dataset.raw, rowIndex, latitudeIndex)),
        ],
        bounds,
      );
    });
  }

  if (
    bounds.maxLatitude < bounds.minLatitude ||
    bounds.maxLongitude < bounds.minLongitude
  ) {
    return null;
  }

  if (bounds.minLatitude === bounds.maxLatitude) {
    bounds.minLatitude -= 0.01;
    bounds.maxLatitude += 0.01;
  }

  if (bounds.minLongitude === bounds.maxLongitude) {
    bounds.minLongitude -= 0.01;
    bounds.maxLongitude += 0.01;
  }

  return [
    [bounds.minLongitude, bounds.minLatitude],
    [bounds.maxLongitude, bounds.maxLatitude],
  ] as [[number, number], [number, number]];
}

function tooltipFields(value: any): string[] {
  return toArray(value)
    .map((field) => String(objectValue(field, "name") || ""))
    .filter(Boolean);
}

function modeLabel(mode: IsochroneMode) {
  return {
    drive_traffic: "Carro com trânsito",
    drive: "Carro",
    bicycle: "Bicicleta",
    walk: "Caminhada",
  }[mode];
}

function getCanvasRect() {
  const canvas = document.querySelector(
    ".mapboxgl-canvas",
  ) as HTMLElement | null;

  return canvas?.getBoundingClientRect() || null;
}

export default function MapOverlayControls() {
  const dispatch = useDispatch();
  const { projectSlug } = useParams();
  const {
    context,
    customMapOverlayEnabled,
  } = useMapPanel();
  const visState = useSelector(selectKeplerVisState) || {};
  const uiState = useSelector(selectKeplerUiState) || {};
  const viewportState =
    useSelector(selectKeplerViewportState) || {};
  const capabilities = context?.capabilities;
  const layers = objectValue(visState, "layers");
  const rawDatasets = objectValue(visState, "datasets");
  const datasets = useMemo(
    () => datasetViews(rawDatasets),
    [rawDatasets],
  );
  const bounds = useMemo(
    () => calculateBounds(layers, datasets),
    [datasets, layers],
  );
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
  const isochroneRequestRef = useRef<AbortController | null>(null);
  const mapControls = objectValue(uiState, "mapControls");
  const mapLegend = objectValue(mapControls, "mapLegend");
  const legendActive = Boolean(
    objectValue(mapLegend, "active"),
  );

  useEffect(
    () => () => isochroneRequestRef.current?.abort(),
    [],
  );

  const unproject = useCallback(
    (clientX: number, clientY: number) => {
      const rect = getCanvasRect();

      if (
        !rect ||
        !viewportState?.width ||
        !viewportState?.height
      ) {
        return null;
      }

      const x =
        ((clientX - rect.left) / rect.width) *
        viewportState.width;
      const y =
        ((clientY - rect.top) / rect.height) *
        viewportState.height;
      const viewport = new WebMercatorViewport(viewportState);
      const [longitudeRaw, latitude] = viewport.unproject([x, y]);
      let longitude = longitudeRaw;

      while (longitude > 180) longitude -= 360;
      while (longitude < -180) longitude += 360;

      return {
        latitude,
        longitude,
      };
    },
    [viewportState],
  );

  const markerPosition = useMemo(() => {
    const rect =
      typeof document === "undefined" ? null : getCanvasRect();

    if (
      !rect ||
      !markerOrigin ||
      !viewportState?.width ||
      !viewportState?.height
    ) {
      return null;
    }

    const viewport = new WebMercatorViewport(viewportState);
    const [x, y] = viewport.project([
      markerOrigin.longitude,
      markerOrigin.latitude,
    ]);

    return {
      left: rect.left + (x / viewportState.width) * rect.width,
      top: rect.top + (y / viewportState.height) * rect.height,
    };
  }, [
    markerOrigin,
    viewportState,
    viewportState?.bearing,
    viewportState?.height,
    viewportState?.latitude,
    viewportState?.longitude,
    viewportState?.pitch,
    viewportState?.width,
    viewportState?.zoom,
  ]);

  if (
    !customMapOverlayEnabled ||
    typeof document === "undefined"
  ) {
    return null;
  }

  function focusVisibleData() {
    if (
      !bounds ||
      !capabilities?.focusMapData ||
      !viewportState?.width ||
      !viewportState?.height
    ) {
      return;
    }

    const viewport = new WebMercatorViewport({
      width: viewportState.width,
      height: viewportState.height,
    });
    const fitted = viewport.fitBounds(bounds, {
      padding: 100,
    });
    const [longitude, latitude] = fitted.unproject([
      viewportState.width / 2,
      viewportState.height / 2,
    ]);

    dispatch(
      wrapTo(
        KEPLER_MAP_ID,
        updateMap({
          bearing: viewportState.bearing || 0,
          latitude,
          longitude,
          pitch: viewportState.pitch || 0,
          zoom: Math.max(0, fitted.zoom - 0.35),
        }),
      ),
    );
  }

  function openTooltipEditor() {
    if (!capabilities?.configureTooltips) return;

    const interactionConfig = objectValue(
      visState,
      "interactionConfig",
    );
    const tooltip = objectValue(interactionConfig, "tooltip");
    const tooltipConfig =
      toPlain(objectValue(tooltip, "config")) || {};
    const fieldsToShow =
      toPlain(tooltipConfig.fieldsToShow) || {};
    const nextDraft: Record<string, string[]> = {};

    datasets.forEach((dataset) => {
      nextDraft[dataset.id] = tooltipFields(
        fieldsToShow[dataset.id],
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
    if (!capabilities?.configureTooltips) return;

    const interactionConfig = objectValue(
      visState,
      "interactionConfig",
    );
    const tooltip = objectValue(interactionConfig, "tooltip");
    const tooltipState = toPlain(tooltip) || {};
    const tooltipConfig =
      toPlain(objectValue(tooltip, "config")) || {};
    const fieldsToShow = Object.fromEntries(
      Object.entries(tooltipDraft).map(
        ([datasetId, fields]) => [
          datasetId,
          fields.map((name) => ({ name, format: null })),
        ],
      ),
    );

    dispatch(
      wrapTo(
        KEPLER_MAP_ID,
        interactionConfigChange({
          tooltip: {
            ...tooltipState,
            enabled: true,
            config: {
              ...tooltipConfig,
              fieldsToShow,
            },
          },
        } as any),
      ),
    );
    setTooltipsOpen(false);
  }

  function resetMarker() {
    setPlacingMarker(false);
    setMarkerOrigin(null);
    setMarkerMenuOpen(false);
    setIsochroneOpen(false);
    setIsochroneError(null);
  }

  function discardPreview() {
    if (!preview) return;

    dispatch(
      wrapTo(
        KEPLER_MAP_ID,
        removeDataset(preview.dataId),
      ),
    );
    setPreview(null);
    resetMarker();
  }

  function persistPreview() {
    if (!preview || !capabilities?.persistIsochrone) return;

    window.dispatchEvent(
      new CustomEvent("maono:save-map", {
        detail: {
          source: "isochrone-preview",
          dataId: preview.dataId,
        },
      }),
    );
    setPreview(null);
    resetMarker();
  }

  async function createIsochrone(input: {
    type: IsochroneType;
    mode: IsochroneMode;
    ranges: number[];
  }) {
    if (
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
      const dataId = `maono_isochrone_${Date.now()}`;
      const label = `Análise: ${modeLabel(input.mode)}`;
      const processedGeojson = processGeojson(result.geojson);

      if (!processedGeojson) {
        throw new Error("GeoJSON de isócrona inválido.");
      }

      const config: AddDataToMapConfig = {
        version: "v1",
        config: {
          visState: {
            layers: [
              {
                id: `layer_${dataId}`,
                type: "geojson",
                config: {
                  dataId,
                  label,
                  color: [197, 160, 89],
                  columns: { geojson: "_geojson" },
                  isVisible: true,
                  visConfig: {
                    opacity: 0.28,
                    filled: true,
                    stroked: true,
                    strokeColor: [183, 121, 31],
                    strokeOpacity: 0.95,
                    thickness: 1.5,
                  },
                },
              },
            ],
          },
        },
      };

      dispatch(
        wrapTo(
          KEPLER_MAP_ID,
          addDataToMap({
            datasets: {
              info: { id: dataId, label },
              data: processedGeojson,
            },
            options: {
              centerMap: true,
              keepExistingConfig: true,
            },
            config,
          }),
        ),
      );
      setPreview({ dataId, label });
      setIsochroneOpen(false);
      setMarkerMenuOpen(false);
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        return;
      }

      setIsochroneError(
        error instanceof Error
          ? error.message
          : "Não foi possível gerar a análise.",
      );
    } finally {
      if (isochroneRequestRef.current === controller) {
        isochroneRequestRef.current = null;
      }
      setIsochroneBusy(false);
    }
  }

  const canvasRect = getCanvasRect();

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
            const origin = unproject(event.clientX, event.clientY);

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
              setDraggingMarker(true);
            }}
            onPointerMove={(event) => {
              if (!draggingMarker) return;
              const origin = unproject(
                event.clientX,
                event.clientY,
              );
              if (origin) setMarkerOrigin(origin);
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(
                event.pointerId,
              );
              setDraggingMarker(false);
              setMarkerMenuOpen(true);
            }}
            onClick={() =>
              setMarkerMenuOpen((current) => !current)
            }
            title="Arraste para mover a origem"
            aria-label="Origem da isócrona; arraste para mover"
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
              {datasets.length ? (
                datasets.map((dataset) => (
                  <fieldset key={dataset.id}>
                    <legend>{dataset.label}</legend>
                    {dataset.fields.map((field) => (
                      <label key={field}>
                        <input
                          type="checkbox"
                          checked={Boolean(
                            tooltipDraft[dataset.id]?.includes(field),
                          )}
                          onChange={() =>
                            toggleTooltipField(dataset.id, field)
                          }
                        />
                        <span>{field}</span>
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
                <small>Prévia gerada</small>
                <strong>{preview.label}</strong>
              </span>
            </div>
            <div>
              {capabilities?.persistIsochrone ? (
                <button
                  type="button"
                  className="is-primary"
                  onClick={persistPreview}
                >
                  Salvar no projeto
                </button>
              ) : null}
              <button type="button" onClick={discardPreview}>
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
              disabled={!bounds}
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
            >
              <OverlayIcon name="tooltip" />
            </button>
          ) : null}

          {capabilities?.toggleLegend ? (
            <button
              type="button"
              className={legendActive ? "is-active" : ""}
              onClick={() =>
                dispatch(
                  wrapTo(
                    KEPLER_MAP_ID,
                    toggleMapControl("mapLegend", 0),
                  ),
                )
              }
              title="Mostrar ou ocultar legenda"
              aria-label="Mostrar ou ocultar legenda"
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
            isochroneRequestRef.current?.abort();
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
