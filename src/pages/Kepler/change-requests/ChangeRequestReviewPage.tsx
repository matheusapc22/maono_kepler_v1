import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  addFilter as addKeplerFilter,
  interactionConfigChange,
  layerConfigChange,
  layerTypeChange,
  layerVisConfigChange,
  layerVisualChannelConfigChange,
  removeFilter as removeKeplerFilter,
  reorderLayer as reorderKeplerLayer,
  setFilter,
  updateLayerBlending,
  updateMap,
  updateOverlayBlending,
  wrapTo,
} from "@kepler.gl/actions";
import { useDispatch, useSelector, useStore } from "react-redux";
import { Link, useParams } from "react-router";

import KeplerApp from "../index";
import {
  markerOriginToScreen,
  type MapCanvasRect,
} from "../components/map-overlay/marker-projection";
import { keplerColumnsFromSnapshot } from "../engine-adapter/layer-management";
import {
  KEPLER_MAP_ID,
  collectionToArray,
  findRawDataset,
  findRawLayer,
  normalizeKeplerDatasets,
  normalizeKeplerViewport,
  readValue,
  selectKeplerViewportState,
  selectKeplerVisState,
} from "../engine-adapter/selectors";
import type { MapLayerColumns, MapViewportSummary } from "../engine-adapter/types";
import {
  applyProjectChangeReview,
  changeProjectChangeReviewState,
  getProjectChangeReview,
  type ProjectChangeReview,
  type ReviewOperationProjection,
} from "./review-api";
import { ReviewAnalysisGeometryLayer } from "./ReviewAnalysisGeometryLayer";
import "./review-workspace.css";

type ProjectedPoint = {
  id: string;
  left: number;
  top: number;
};

type StyleSnapshot = Partial<{
  fixedColor: [number, number, number] | null;
  opacity: number | null;
  fillEnabled: boolean | null;
  strokeEnabled: boolean | null;
  strokeColor: [number, number, number] | null;
  strokeOpacity: number | null;
  strokeWidth: number | null;
  pointRadius: number | null;
  clusterRadius: number | null;
  heatmapRadius: number | null;
}>;

type PersistentFilterSnapshot = {
  id: string;
  dataIds: string[];
  fieldNames: string[];
  type: string;
  value: unknown;
  enabled: boolean;
};

const PERSISTENT_VISUAL_TYPES = new Set<ReviewOperationProjection["type"]>([
  "layer.create",
  "layer.duplicate",
  "layer.remove",
  "layer.definition.update",
  "layer.visibility.update",
  "persistent.filter.update",
  "layer.order.update",
  "tooltip.config.update",
  "map.blending.update",
]);

function safeMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Não foi possível concluir a operação de Review.";
}

function mapSurfaceRect(): MapCanvasRect | null {
  const node = document.querySelector<HTMLElement>(".maono-kepler-viewport");
  const rect = node?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function record(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function styleSnapshot(
  operation: ReviewOperationProjection,
  mode: "before" | "after",
): StyleSnapshot | null {
  if (operation.type !== "layer.style.update") return null;
  const properties = record(operation.properties);
  return record(properties?.[mode]) as StyleSnapshot | null;
}

function operationTitle(type: ReviewOperationProjection["type"]) {
  if (type === "layer.create") return "Criar camada";
  if (type === "layer.duplicate") return "Duplicar camada";
  if (type === "layer.remove") return "Remover camada";
  if (type === "layer.style.update") return "Alterar estilo";
  if (type === "layer.definition.update") return "Alterar configuração da camada";
  if (type === "layer.visibility.update") return "Alterar visibilidade";
  if (type === "persistent.filter.update") return "Alterar filtro";
  if (type === "layer.order.update") return "Reordenar camadas";
  if (type === "tooltip.config.update") return "Alterar tooltip";
  if (type === "map.blending.update") return "Alterar composição visual";
  if (type === "buffer.create") return "Criar Buffer";
  if (type === "isochrone.create") return "Criar Isócrona";
  return "Criar ponto";
}

function operationSummary(operation: ReviewOperationProjection | null) {
  if (!operation) return null;
  const style = operation.type === "layer.style.update";
  const persistentVisual = PERSISTENT_VISUAL_TYPES.has(operation.type);
  const properties = record(operation.properties) || {};
  return {
    type: operation.type,
    title: operationTitle(operation.type),
    target:
      operation.target.label || operation.target.layerId || "Camada de destino",
    focus: operation.focus,
    properties: style || persistentVisual ? [] : Object.entries(operation.properties || {}),
    before: style ? styleSnapshot(operation, "before") : null,
    after: style ? styleSnapshot(operation, "after") : null,
    persistentVisual,
    beforeLabel: persistentVisual
      ? String(properties.beforeLabel ?? displayPersistentValue(properties.before))
      : null,
    afterLabel: persistentVisual
      ? String(properties.afterLabel ?? displayPersistentValue(properties.after))
      : null,
  };
}

function displayStyleValue(value: unknown) {
  if (Array.isArray(value) && value.length === 3) {
    return `rgb(${value.join(", ")})`;
  }
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (value === null || value === undefined) return "—";
  return String(value);
}

function displayPersistentValue(value: unknown) {
  if (value === null || value === undefined) return "Sem configuração";
  if (Array.isArray(value)) return value.map(String).join(" → ");
  if (typeof value === "boolean") return value ? "Ativo" : "Inativo";
  const source = record(value);
  if (source) {
    const fields = Array.isArray(source.fieldNames)
      ? source.fieldNames.map(String).join(", ")
      : "Configuração";
    const raw = source.value;
    if (raw === undefined) return fields;
    const rendered = Array.isArray(raw)
      ? raw.map(String).join(" – ")
      : String(raw ?? "—");
    return `${fields}: ${rendered}`;
  }
  return String(value);
}

function styleRows(before: StyleSnapshot | null, after: StyleSnapshot | null) {
  const keys = Array.from(
    new Set([...Object.keys(before || {}), ...Object.keys(after || {})]),
  );
  return keys.filter(
    (key) =>
      JSON.stringify((before as Record<string, unknown> | null)?.[key]) !==
      JSON.stringify((after as Record<string, unknown> | null)?.[key]),
  );
}

function applyReviewStyleSnapshot(
  dispatch: ReturnType<typeof useDispatch>,
  rootState: unknown,
  operation: ReviewOperationProjection,
  mode: "before" | "after",
) {
  if (operation.type !== "layer.style.update" || !operation.target.layerId) {
    return;
  }
  const snapshot = styleSnapshot(operation, mode);
  if (!snapshot) return;
  const layer = findRawLayer(rootState, operation.target.layerId);
  if (!layer) return;

  if (snapshot.fixedColor) {
    dispatch(
      wrapTo(
        KEPLER_MAP_ID,
        layerConfigChange(layer, { color: snapshot.fixedColor }),
      ),
    );
  }

  const visPatch: Record<string, unknown> = {};
  if (snapshot.opacity != null) visPatch.opacity = snapshot.opacity;
  if (snapshot.fillEnabled != null) visPatch.filled = snapshot.fillEnabled;
  if (snapshot.strokeEnabled != null) {
    const layerType = String(readValue(layer, "type") || "").toLowerCase();
    visPatch[layerType === "point" ? "outline" : "stroked"] =
      snapshot.strokeEnabled;
  }
  if (snapshot.strokeColor) {
    visPatch.strokeColor = snapshot.strokeColor;
  }
  if (snapshot.strokeOpacity != null) {
    visPatch.strokeOpacity = snapshot.strokeOpacity;
  }
  if (snapshot.strokeWidth != null) visPatch.thickness = snapshot.strokeWidth;
  if (snapshot.pointRadius != null) visPatch.radius = snapshot.pointRadius;
  if (snapshot.clusterRadius != null) {
    visPatch.clusterRadius = snapshot.clusterRadius;
  }
  if (snapshot.heatmapRadius != null) {
    visPatch.heatmapRadius = snapshot.heatmapRadius;
  }
  if (Object.keys(visPatch).length) {
    dispatch(
      wrapTo(
        KEPLER_MAP_ID,
        layerVisConfigChange(layer, visPatch as Parameters<typeof layerVisConfigChange>[1]),
      ),
    );
  }
}

function filterSnapshotForMode(
  operation: ReviewOperationProjection,
  mode: "before" | "after",
): PersistentFilterSnapshot | null {
  if (operation.type !== "persistent.filter.update") return null;
  const properties = record(operation.properties);
  const snapshot = record(properties?.[mode]);
  if (!snapshot) return null;
  const dataIds = Array.isArray(snapshot.dataIds) ? snapshot.dataIds.map(String) : [];
  const fieldNames = Array.isArray(snapshot.fieldNames) ? snapshot.fieldNames.map(String) : [];
  if (!String(snapshot.id || "").trim() || dataIds.length !== 1 || fieldNames.length !== 1) {
    return null;
  }
  return {
    id: String(snapshot.id),
    dataIds,
    fieldNames,
    type: String(snapshot.type || ""),
    value: snapshot.value,
    enabled: snapshot.enabled !== false,
  };
}

function rawFilterIndex(rootState: unknown, filterId: string) {
  const visState = selectKeplerVisState(rootState);
  const filters = collectionToArray(readValue(visState, "filters"));
  return filters.findIndex((filter) => String(readValue(filter, "id") || "") === filterId);
}

function applyReviewPersistentVisualization(
  dispatch: ReturnType<typeof useDispatch>,
  rootState: unknown,
  operation: ReviewOperationProjection,
  mode: "before" | "after",
  filterIndexes: Map<string, number>,
) {
  const properties = record(operation.properties) || {};

  if (operation.type === "layer.visibility.update" && operation.target.layerId) {
    const layer = findRawLayer(rootState, operation.target.layerId);
    const visible = properties[mode];
    if (!layer || typeof visible !== "boolean") return;
    dispatch(
      wrapTo(
        KEPLER_MAP_ID,
        layerConfigChange(layer, { isVisible: visible }),
      ),
    );
    return;
  }

  if (operation.type === "layer.order.update") {
    const ids = properties[mode];
    if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === "string")) {
      return;
    }
    dispatch(wrapTo(KEPLER_MAP_ID, reorderKeplerLayer(ids)));
    return;
  }

  if (operation.type !== "persistent.filter.update") return;

  const snapshot = filterSnapshotForMode(operation, mode);
  const otherMode = mode === "before" ? "after" : "before";
  const otherSnapshot = filterSnapshotForMode(operation, otherMode);
  const filterId = snapshot?.id || otherSnapshot?.id || "";
  let index = filterIndexes.get(operation.id) ?? (filterId ? rawFilterIndex(rootState, filterId) : -1);

  if (!snapshot) {
    if (index >= 0) {
      dispatch(wrapTo(KEPLER_MAP_ID, removeKeplerFilter(index)));
      filterIndexes.delete(operation.id);
    }
    return;
  }

  if (index < 0) {
    const filters = collectionToArray(
      readValue(selectKeplerVisState(rootState), "filters"),
    );
    index = filters.length;
    dispatch(wrapTo(KEPLER_MAP_ID, addKeplerFilter(snapshot.dataIds[0])));
    filterIndexes.set(operation.id, index);
  }

  dispatch(wrapTo(KEPLER_MAP_ID, setFilter(index, "dataId", snapshot.dataIds[0], 0)));
  dispatch(wrapTo(KEPLER_MAP_ID, setFilter(index, "name", snapshot.fieldNames[0], 0)));
  dispatch(wrapTo(KEPLER_MAP_ID, setFilter(index, "value", snapshot.value)));
  dispatch(wrapTo(KEPLER_MAP_ID, setFilter(index, "enabled", snapshot.enabled)));
}

function rawDatasetField(rootState: unknown, dataId: string, fieldName: string) {
  if (!dataId || !fieldName) return null;
  const dataset = findRawDataset(rootState, dataId);
  const fields = collectionToArray<any>(
    readValue(dataset, "fields") ?? readValue(readValue(dataset, "data"), "fields"),
  );
  return (
    fields.find(
      (field) => String(readValue(field, "name") || "") === fieldName,
    ) || null
  );
}

function mapColumns(rootState: unknown, dataId: string, value: unknown) {
  const source = record(value) || {};
  const visState = selectKeplerVisState(rootState);
  const dataset = normalizeKeplerDatasets(readValue(visState, "datasets")).find(
    (candidate) => candidate.id === dataId,
  );
  if (!dataset) return null;
  const columns: MapLayerColumns = {
    latitude: text(source.latitude) || null,
    longitude: text(source.longitude) || null,
    geojson: text(source.geojson) || null,
    altitude: text(source.altitude) || null,
  };
  return keplerColumnsFromSnapshot(columns, dataset);
}

function applyReviewCoverageMutation(
  dispatch: ReturnType<typeof useDispatch>,
  rootState: unknown,
  operation: ReviewOperationProjection,
  mode: "before" | "after",
) {
  const properties = record(operation.properties) || {};
  const snapshot = record(properties[mode]);
  if (!snapshot) return;

  if (operation.type === "layer.definition.update" && operation.target.layerId) {
    const layer = findRawLayer(rootState, operation.target.layerId);
    if (!layer) return;
    const type = text(snapshot.type).toLowerCase();
    const dataIds = Array.isArray(snapshot.dataIds) ? snapshot.dataIds.map(String) : [];
    const dataId = text(dataIds[0]);
    if (type && String(readValue(layer, "type") || "").toLowerCase() !== type) {
      dispatch(wrapTo(KEPLER_MAP_ID, layerTypeChange(layer, type as any)));
    }

    const configPatch: Record<string, unknown> = {};
    if (dataId) configPatch.dataId = dataId;
    if (text(snapshot.label)) configPatch.label = text(snapshot.label);
    const columns = dataId ? mapColumns(rootState, dataId, snapshot.columns) : null;
    if (columns) configPatch.columns = columns;
    if (Object.keys(configPatch).length) {
      dispatch(wrapTo(KEPLER_MAP_ID, layerConfigChange(layer, configPatch)));
    }

    const colorFieldName = text(snapshot.colorField);
    const colorField = colorFieldName
      ? rawDatasetField(rootState, dataId, colorFieldName)
      : null;
    dispatch(
      wrapTo(
        KEPLER_MAP_ID,
        layerVisualChannelConfigChange(
          layer,
          {
            colorField,
            ...(colorField && text(snapshot.colorScale)
              ? { colorScale: text(snapshot.colorScale) }
              : {}),
          } as any,
          "color",
        ),
      ),
    );

    const strokeFieldName = text(snapshot.strokeColorField);
    const strokeField = strokeFieldName
      ? rawDatasetField(rootState, dataId, strokeFieldName)
      : null;
    if (strokeFieldName || snapshot.strokeColorField === null) {
      dispatch(
        wrapTo(
          KEPLER_MAP_ID,
          layerVisualChannelConfigChange(
            layer,
            {
              strokeColorField: strokeField,
              ...(strokeField && text(snapshot.strokeColorScale)
                ? { strokeColorScale: text(snapshot.strokeColorScale) }
                : {}),
            } as any,
            "strokeColor",
          ),
        ),
      );
    }

    const radiusFieldName = text(snapshot.radiusField);
    const radiusField = radiusFieldName
      ? rawDatasetField(rootState, dataId, radiusFieldName)
      : null;
    if (radiusFieldName || snapshot.radiusField === null) {
      const key = type === "geojson" ? "radiusField" : "sizeField";
      const channel = type === "geojson" ? "radius" : "size";
      dispatch(
        wrapTo(
          KEPLER_MAP_ID,
          layerVisualChannelConfigChange(
            layer,
            { [key]: radiusField } as any,
            channel,
          ),
        ),
      );
    }

    const visPatch: Record<string, unknown> = {};
    const colorPalette = Array.isArray(snapshot.colorPalette)
      ? snapshot.colorPalette.map(String)
      : [];
    if (colorPalette.length >= 2) {
      visPatch.colorRange = {
        name: `maono:${text(snapshot.colorPaletteId) || "custom"}`,
        type: "sequential",
        category: "Maõno",
        colors: colorPalette,
      };
    }
    const strokePalette = Array.isArray(snapshot.strokeColorPalette)
      ? snapshot.strokeColorPalette.map(String)
      : [];
    if (strokePalette.length >= 2) {
      visPatch.strokeColorRange = {
        name: `maono:${text(snapshot.strokeColorPaletteId) || "custom"}`,
        type: "sequential",
        category: "Maõno",
        colors: strokePalette,
      };
    }
    if (Array.isArray(snapshot.radiusRange) && snapshot.radiusRange.length === 2) {
      visPatch.radiusRange = snapshot.radiusRange.map(Number);
    }
    if (Object.keys(visPatch).length) {
      dispatch(
        wrapTo(
          KEPLER_MAP_ID,
          layerVisConfigChange(layer, visPatch as Parameters<typeof layerVisConfigChange>[1]),
        ),
      );
    }
    return;
  }

  if (operation.type === "tooltip.config.update") {
    const visState = selectKeplerVisState(rootState);
    const interactionConfig = readValue(visState, "interactionConfig");
    const tooltip = readValue(interactionConfig, "tooltip");
    const tooltipConfig = readValue(tooltip, "config") || {};
    const rawFields = record(snapshot.fieldsByDataset) || {};
    const fieldsToShow = Object.fromEntries(
      Object.entries(rawFields).map(([dataId, values]) => [
        dataId,
        Array.isArray(values)
          ? values.flatMap((value) => {
              const item = record(value);
              const name = text(item?.name);
              return name
                ? [{ name, format: item?.format == null ? null : String(item.format) }]
                : [];
            })
          : [],
      ]),
    );
    dispatch(
      wrapTo(
        KEPLER_MAP_ID,
        interactionConfigChange({
          ...(typeof tooltip?.toJS === "function" ? tooltip.toJS() : tooltip || {}),
          id: String(readValue(tooltip, "id") ?? "tooltip"),
          enabled: snapshot.enabled !== false,
          config: {
            ...(typeof tooltipConfig?.toJS === "function"
              ? tooltipConfig.toJS()
              : tooltipConfig),
            fieldsToShow,
          },
        }),
      ),
    );
    return;
  }

  if (operation.type === "map.blending.update") {
    const layers = text(snapshot.layers);
    const overlays = text(snapshot.overlays);
    if (layers) dispatch(wrapTo(KEPLER_MAP_ID, updateLayerBlending(layers as any)));
    if (overlays) dispatch(wrapTo(KEPLER_MAP_ID, updateOverlayBlending(overlays as any)));
  }
}

function ReviewMarkerLayer({
  operations,
  selectedId,
  visible,
  viewport,
}: {
  operations: ReviewOperationProjection[];
  selectedId: string | null;
  visible: boolean;
  viewport: MapViewportSummary | null;
}) {
  const [points, setPoints] = useState<ProjectedPoint[]>([]);

  const refresh = useCallback(() => {
    if (!visible || !viewport) {
      setPoints([]);
      return;
    }
    const rect = mapSurfaceRect();
    if (!rect) return;
    const next = operations.flatMap((operation) => {
      if (operation.overlay?.kind !== "point") return [];
      const position = markerOriginToScreen(
        {
          latitude: operation.overlay.latitude,
          longitude: operation.overlay.longitude,
        },
        rect,
        viewport,
      );
      return position
        ? [{ id: operation.id, left: position.left, top: position.top }]
        : [];
    });
    setPoints(next);
  }, [operations, viewport, visible]);

  useEffect(() => {
    refresh();
    window.addEventListener("resize", refresh);
    window.addEventListener("maono:map-runtime", refresh);
    return () => {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("maono:map-runtime", refresh);
    };
  }, [refresh]);

  if (!visible) return null;
  return (
    <div className="maono-review-markers" aria-hidden="true">
      {points.map((point) => (
        <span
          key={point.id}
          className={`maono-review-marker${point.id === selectedId ? " is-selected" : ""}`}
          style={{ left: point.left, top: point.top }}
        />
      ))}
    </div>
  );
}

function ReviewWorkspaceOverlay({
  projectSlug,
  changeRequestId,
}: {
  projectSlug: string;
  changeRequestId: string;
}) {
  const dispatch = useDispatch();
  const store = useStore();
  const viewport = useSelector((state: any) =>
    normalizeKeplerViewport(selectKeplerViewportState(state)),
  );
  const [review, setReview] = useState<ProjectChangeReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState<"before" | "after">("after");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  const startedRef = useRef(false);
  const reviewFilterIndexesRef = useRef(new Map<string, number>());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let loaded = await getProjectChangeReview(projectSlug, changeRequestId);
      if (loaded.changeRequest.status === "submitted" && !startedRef.current) {
        startedRef.current = true;
        loaded = await changeProjectChangeReviewState(projectSlug, changeRequestId, {
          action: "start",
        });
      }
      setReview(loaded);
    } catch (loadError) {
      setError(safeMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [changeRequestId, projectSlug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const operations = review?.proposal?.operations || [];
  useEffect(() => {
    if (!operations.length) {
      setSelectedIndex(0);
      return;
    }
    setSelectedIndex((current) => Math.min(current, operations.length - 1));
  }, [operations.length]);

  useEffect(() => {
    if (!operations.length) return;
    for (const operation of operations) {
      const rootState = store.getState();
      applyReviewStyleSnapshot(dispatch, rootState, operation, compareMode);
      applyReviewPersistentVisualization(
        dispatch,
        rootState,
        operation,
        compareMode,
        reviewFilterIndexesRef.current,
      );
      applyReviewCoverageMutation(dispatch, store.getState(), operation, compareMode);
    }
  }, [compareMode, dispatch, operations, store]);

  const selected = operations[selectedIndex] || null;
  const summary = useMemo(() => operationSummary(selected), [selected]);

  const focusOperation = useCallback(
    (operation: ReviewOperationProjection | null) => {
      if (!operation?.focus) return;
      dispatch(
        wrapTo(
          KEPLER_MAP_ID,
          updateMap({
            longitude: operation.focus.longitude,
            latitude: operation.focus.latitude,
            zoom: Math.max(Number(viewport?.zoom ?? 0), 12),
          }),
        ),
      );
    },
    [dispatch, viewport?.zoom],
  );

  function selectIndex(next: number) {
    if (!operations.length) return;
    const normalized = Math.max(0, Math.min(next, operations.length - 1));
    setSelectedIndex(normalized);
    focusOperation(operations[normalized]);
  }

  async function approve() {
    if (!review?.permissions.canApprove || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await changeProjectChangeReviewState(projectSlug, changeRequestId, {
        action: "approve",
      });
      setReview(updated);
      setToast("Solicitação aprovada. Nenhuma revisão foi publicada ainda.");
    } catch (actionError) {
      setError(safeMessage(actionError));
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    if (!rejectComment.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await changeProjectChangeReviewState(projectSlug, changeRequestId, {
        action: "reject",
        comment: rejectComment.trim(),
      });
      setReview(updated);
      setRejectOpen(false);
      setRejectComment("");
      setToast("Solicitação rejeitada.");
    } catch (actionError) {
      setError(safeMessage(actionError));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!review?.permissions.canApply || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await applyProjectChangeReview(projectSlug, changeRequestId);
      setReview(result.review);
      setToast(
        `Alterações aplicadas na REV ${result.appliedRevision} do mesmo projeto.`,
      );
    } catch (actionError) {
      setError(safeMessage(actionError));
      try {
        setReview(
          await getProjectChangeReview(projectSlug, changeRequestId, {
            force: true,
          }),
        );
      } catch {
        // Mantém o erro principal; refresh é best-effort.
      }
    } finally {
      setBusy(false);
    }
  }

  const changedStyleKeys = summary
    ? styleRows(summary.before, summary.after)
    : [];

  return (
    <>
      <ReviewMarkerLayer
        operations={operations}
        selectedId={selected?.id || null}
        visible={compareMode === "after"}
        viewport={viewport}
      />
      <ReviewAnalysisGeometryLayer
        operations={operations}
        selectedId={selected?.id || null}
        visible={compareMode === "after"}
        viewport={viewport}
      />

      <aside className="maono-review-panel" aria-label="Review da solicitação">
        <header className="maono-review-panel__header">
          <div>
            <small>Review workspace</small>
            <h1>{review?.project.name || "Revisão de alteração"}</h1>
          </div>
          <Link to={`/projects/${encodeURIComponent(projectSlug)}/requests`}>
            Solicitações
          </Link>
          <Link to={`/projects/${encodeURIComponent(projectSlug)}/edit`}>
            Voltar ao projeto
          </Link>
        </header>

        {loading ? (
          <div className="maono-review-panel__state" role="status">
            <strong>Carregando revisão-base</strong>
            <span>Validando operações e proposta…</span>
          </div>
        ) : null}

        {!loading && error ? (
          <div className="maono-review-panel__error" role="alert">
            {error}
          </div>
        ) : null}

        {review ? (
          <div className="maono-review-panel__body">
            <div className="maono-review-revisions">
              <span>Base <strong>REV {review.base.revision}</strong></span>
              <span>Atual <strong>REV {review.project.currentRevision}</strong></span>
              <span className={`maono-review-status is-${review.changeRequest.status}`}>
                {review.changeRequest.status.replaceAll("_", " ")}
              </span>
            </div>

            {review.conflict ? (
              <div className="maono-review-conflict" role="alert">
                <strong>Conflito de revisão</strong>
                <span>{review.conflict.message}</span>
                <small>
                  A aplicação automática foi bloqueada para não sobrescrever alterações mais recentes.
                </small>
              </div>
            ) : null}

            <div className="maono-review-compare" role="group" aria-label="Comparação">
              <button
                type="button"
                className={compareMode === "before" ? "is-active" : ""}
                onClick={() => setCompareMode("before")}
              >
                Antes
              </button>
              <button
                type="button"
                className={compareMode === "after" ? "is-active" : ""}
                onClick={() => setCompareMode("after")}
              >
                Depois
              </button>
            </div>

            <section className="maono-review-operation">
              <div className="maono-review-operation__nav">
                <button
                  type="button"
                  aria-label="Operação anterior"
                  disabled={selectedIndex <= 0}
                  onClick={() => selectIndex(selectedIndex - 1)}
                >
                  ‹
                </button>
                <strong>
                  {operations.length
                    ? `Operação ${selectedIndex + 1} de ${operations.length}`
                    : "Sem operação disponível"}
                </strong>
                <button
                  type="button"
                  aria-label="Próxima operação"
                  disabled={selectedIndex >= operations.length - 1}
                  onClick={() => selectIndex(selectedIndex + 1)}
                >
                  ›
                </button>
              </div>

              {summary ? (
                <div className="maono-review-operation__details">
                  <h2>{summary.title}</h2>
                  <span>Camada: {summary.target}</span>
                  {summary.focus ? (
                    <>
                      <span>Lat: {summary.focus.latitude.toFixed(6)}</span>
                      <span>Lng: {summary.focus.longitude.toFixed(6)}</span>
                    </>
                  ) : null}

                  {summary.type === "layer.style.update" ? (
                    <div className="maono-review-properties">
                      {changedStyleKeys.length ? (
                        changedStyleKeys.map((key) => (
                          <div key={key}>
                            <small>{key}</small>
                            <span>
                              Antes: {displayStyleValue(
                                (summary.before as Record<string, unknown> | null)?.[key],
                              )}
                            </span>
                            <span>
                              Depois: {displayStyleValue(
                                (summary.after as Record<string, unknown> | null)?.[key],
                              )}
                            </span>
                          </div>
                        ))
                      ) : (
                        <span>Sem diferença visual efetiva.</span>
                      )}
                    </div>
                  ) : summary.persistentVisual ? (
                    <div className="maono-review-properties">
                      <div>
                        <small>Antes</small>
                        <span>{summary.beforeLabel || "—"}</span>
                      </div>
                      <div>
                        <small>Depois</small>
                        <span>{summary.afterLabel || "—"}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="maono-review-properties">
                      {summary.properties.length ? (
                        summary.properties.map(([key, value]) => (
                          <div key={key}>
                            <small>{key}</small>
                            <span>
                              {typeof value === "object"
                                ? JSON.stringify(value)
                                : String(value ?? "")}
                            </span>
                          </div>
                        ))
                      ) : (
                        <span>Sem atributos adicionais.</span>
                      )}
                    </div>
                  )}

                  {summary.focus ? (
                    <button type="button" onClick={() => focusOperation(selected)}>
                      Focar no mapa
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>

            <div className="maono-review-reason">
              <small>Motivo enviado</small>
              <p>{review.changeRequest.reason}</p>
            </div>

            <footer className="maono-review-actions">
              <button
                type="button"
                disabled={!review.permissions.canReject || busy}
                onClick={() => setRejectOpen(true)}
              >
                Rejeitar
              </button>
              <button
                type="button"
                disabled={!review.permissions.canApprove || busy}
                onClick={() => void approve()}
              >
                Aprovar
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={!review.permissions.canApply || busy}
                onClick={() => void apply()}
              >
                {busy ? "Processando…" : "Aprovar e aplicar"}
              </button>
            </footer>
          </div>
        ) : null}
      </aside>

      {toast ? (
        <div className="maono-review-toast" role="status">{toast}</div>
      ) : null}

      {rejectOpen ? (
        <div className="maono-review-dialog-backdrop" role="presentation">
          <section className="maono-review-dialog" role="dialog" aria-modal="true">
            <h2>Rejeitar solicitação</h2>
            <p>
              Informe o motivo. O conteúdo enviado pelo Viewer permanecerá imutável.
            </p>
            <textarea
              autoFocus
              maxLength={2000}
              value={rejectComment}
              onChange={(event) => setRejectComment(event.target.value)}
              placeholder="Motivo da rejeição"
            />
            <div>
              <button
                type="button"
                disabled={busy}
                onClick={() => setRejectOpen(false)}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="is-danger"
                disabled={busy || !rejectComment.trim()}
                onClick={() => void reject()}
              >
                Confirmar rejeição
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

export default function ChangeRequestReviewPage() {
  const { projectSlug = "", changeRequestId = "" } = useParams<{
    projectSlug: string;
    changeRequestId: string;
  }>();

  useEffect(() => {
    document.body.classList.add("maono-review-workspace-active");
    return () => document.body.classList.remove("maono-review-workspace-active");
  }, []);

  if (!projectSlug || !changeRequestId) {
    return <main className="maono-review-route-error">Review inválido.</main>;
  }

  return (
    <main className="maono-review-page">
      <KeplerApp />
      <ReviewWorkspaceOverlay
        projectSlug={projectSlug}
        changeRequestId={changeRequestId}
      />
    </main>
  );
}
