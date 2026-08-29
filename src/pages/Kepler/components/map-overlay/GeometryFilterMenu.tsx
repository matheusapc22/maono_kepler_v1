import { useEffect, useMemo, useState } from "react";
import { useDispatch, useStore } from "react-redux";

import { setSelectedFeature, wrapTo } from "@kepler.gl/actions";
import type { Feature } from "@kepler.gl/types";

import {
  applyGeometryFilter,
  geometryFilterLayerOptions,
  updateGeometryFilterLayers,
} from "../../engine-adapter/geometry-filter-command";
import { KEPLER_MAP_ID } from "../../engine-adapter/selectors";
import { authorizeMapPanelCommand } from "../../map-panel/map-panel-capabilities";
import { emitMapPanelTelemetry } from "../../map-panel/map-panel-telemetry";
import { useMapPanel } from "../../map-panel/MapPanelContext";

type GeometryFilterStatus = {
  tone: "error" | "success";
  text: string;
};

type GeometryFilterMenuProps = {
  feature: Feature;
  sourceLayerId?: string | null;
  title?: string;
  description?: string;
  onApplied?: (result: {
    filterId: string;
    affectedLayerIds: string[];
  }) => void;
};

function sameLayerSelection(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  return right.every((id) => leftSet.has(id));
}

export default function GeometryFilterMenu({
  feature,
  sourceLayerId = null,
  title = "Aplicar esta geometria às camadas",
  description = "Selecione exatamente quais camadas devem responder a este polígono.",
  onApplied,
}: GeometryFilterMenuProps) {
  const dispatch = useDispatch();
  const store = useStore();
  const { context } = useMapPanel();
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [filterId, setFilterId] = useState<string | null>(null);
  const [appliedLayerIds, setAppliedLayerIds] = useState<string[]>([]);
  const [status, setStatus] = useState<GeometryFilterStatus | null>(null);

  const layerOptions = useMemo(
    () => geometryFilterLayerOptions(store.getState(), sourceLayerId),
    [sourceLayerId, store],
  );
  const filterableLayerIds = useMemo(
    () => layerOptions.filter((layer) => layer.filterable).map((layer) => layer.id),
    [layerOptions],
  );
  const selectionKey = filterableLayerIds.join("|");

  useEffect(() => {
    setSelectedLayerIds(filterableLayerIds);
    setAppliedLayerIds([]);
    setFilterId(null);
    setStatus(null);
  }, [feature?.id, selectionKey]);

  const authorization = authorizeMapPanelCommand(
    context?.capabilities,
    "filterByGeometry",
    "editFilters",
  );
  const canApply =
    authorization.ok &&
    selectedLayerIds.length > 0 &&
    !sameLayerSelection(selectedLayerIds, appliedLayerIds);

  function telemetry(event: string, code: string | null = null) {
    emitMapPanelTelemetry(event, {
      mode: context?.mode ?? null,
      projectId: context?.project?.id ?? null,
      organizationId: context?.organization?.id ?? null,
      policyVersion: context?.policyVersion ?? null,
      command: "filterByGeometry",
      capability: "editFilters",
      code,
      source: "maono-geometry-filter-menu",
    });
  }

  function clearNativeEditorSelection() {
    dispatch(wrapTo(KEPLER_MAP_ID, setSelectedFeature(null)) as any);
  }

  function toggleLayer(id: string) {
    setStatus(null);
    setSelectedLayerIds((current) =>
      current.includes(id)
        ? current.filter((layerId) => layerId !== id)
        : [...current, id],
    );
  }

  function selectAll() {
    setStatus(null);
    setSelectedLayerIds(filterableLayerIds);
  }

  function clearSelection() {
    setStatus(null);
    setSelectedLayerIds([]);
  }

  function applySelection() {
    setStatus(null);

    if (!authorization.ok) {
      setStatus({ tone: "error", text: authorization.reason });
      telemetry("map_panel_command_denied", authorization.code);
      return;
    }

    const result = filterId
      ? updateGeometryFilterLayers({
          dispatch: (action) => dispatch(action as any),
          getState: () => store.getState(),
          filterId,
          targetLayerIds: selectedLayerIds,
        })
      : applyGeometryFilter({
          dispatch: (action) => dispatch(action as any),
          getState: () => store.getState(),
          feature,
          sourceLayerId,
          targetLayerIds: selectedLayerIds,
        });

    if (!result.ok) {
      setStatus({ tone: "error", text: result.reason });
      telemetry("map_panel_command_denied", result.code);
      return;
    }

    // O Polygon Filter continua sendo o motor espacial, mas a edição visual
    // nativa não faz mais parte da experiência Maõno. Limpar a seleção remove
    // os edit handles azuis do EditableGeoJsonLayer após criar/atualizar.
    clearNativeEditorSelection();

    setFilterId(result.value.filterId);
    setAppliedLayerIds(result.value.affectedLayerIds);
    setSelectedLayerIds(result.value.affectedLayerIds);
    setStatus({
      tone: "success",
      text: `Filtro aplicado em ${result.value.affectedLayerIds.length} camada(s).`,
    });
    telemetry(
      "map_panel_command_executed",
      filterId ? "GEOMETRY_FILTER_UPDATED" : "GEOMETRY_FILTER_CREATED",
    );
    onApplied?.(result.value);
  }

  return (
    <section
      className="maono-map-tooltip__filter-manager"
      aria-label="Gestão de filtragem por geometria"
    >
      <div className="maono-map-tooltip__filter-title">
        <div>
          <small>Filtragem espacial</small>
          <strong>{title}</strong>
          <span>{description}</span>
        </div>
        <div className="maono-map-tooltip__filter-tools">
          <button
            type="button"
            onClick={selectAll}
            disabled={!authorization.ok || !filterableLayerIds.length}
          >
            Todas
          </button>
          <button
            type="button"
            onClick={clearSelection}
            disabled={!authorization.ok || !selectedLayerIds.length}
          >
            Limpar
          </button>
        </div>
      </div>

      <div className="maono-map-tooltip__layer-list">
        {layerOptions.length ? (
          layerOptions.map((layer) => {
            const disabled = !authorization.ok || !layer.filterable;
            const checked = selectedLayerIds.includes(layer.id);
            return (
              <label
                key={layer.id}
                className={`maono-map-tooltip__layer-option${disabled ? " is-disabled" : ""}`}
                title={
                  layer.filterable
                    ? undefined
                    : `A layer ${layer.type || "desconhecida"} não aceita Polygon Filter.`
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggleLayer(layer.id)}
                />
                <span className="maono-map-tooltip__layer-copy">
                  <strong>{layer.label}</strong>
                  <small>{layer.type || "tipo desconhecido"}</small>
                </span>
                <span
                  className={`maono-map-tooltip__layer-state${layer.source ? " is-source" : ""}`}
                >
                  {!layer.filterable
                    ? "incompatível"
                    : layer.source
                      ? "origem"
                      : layer.visible
                        ? "visível"
                        : "oculta"}
                </span>
              </label>
            );
          })
        ) : (
          <p className="maono-map-tooltip__filter-status">
            Nenhuma camada está disponível neste projeto.
          </p>
        )}
      </div>

      <div className="maono-map-tooltip__filter-footer">
        <p
          className={`maono-map-tooltip__filter-status${status ? ` is-${status.tone}` : ""}`}
          role={status?.tone === "error" ? "alert" : "status"}
        >
          {status?.text ||
            (!authorization.ok
              ? authorization.reason
              : selectedLayerIds.length
                ? `${selectedLayerIds.length} camada(s) selecionada(s).`
                : "Selecione pelo menos uma camada para aplicar o filtro.")}
        </p>
        <button
          type="button"
          className="maono-map-tooltip__apply"
          onClick={applySelection}
          disabled={!canApply}
        >
          {filterId ? "Atualizar filtro" : "Aplicar filtro"}
        </button>
      </div>
    </section>
  );
}