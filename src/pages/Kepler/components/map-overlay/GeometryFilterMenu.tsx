import { useEffect, useMemo, useState } from "react";
import { useDispatch, useStore } from "react-redux";

import type { Feature } from "@kepler.gl/types";

import {
  applyGeometryFilter,
  geometryFilterLayerOptions,
  removeGeometryFilter,
  updateGeometryFilterLayers,
} from "../../engine-adapter/geometry-filter-command";
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
  existingFilterId?: string | null;
  initialLayerIds?: string[] | null;
  title?: string;
  description?: string;
  onApplied?: (result: {
    filterId: string;
    affectedLayerIds: string[];
  }) => void;
  onRemoved?: (filterId: string) => void;
  onExit?: () => void;
};

function sameLayerSelection(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  return right.every((id) => leftSet.has(id));
}

function normalizedIds(values: string[] | null | undefined) {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => String(value ?? "").trim())
        .filter(Boolean),
    ),
  );
}

export default function GeometryFilterMenu({
  feature,
  sourceLayerId = null,
  existingFilterId = null,
  initialLayerIds = null,
  title = "Aplicar esta geometria às camadas",
  description = "Selecione exatamente quais camadas devem responder a este polígono.",
  onApplied,
  onRemoved,
  onExit,
}: GeometryFilterMenuProps) {
  const dispatch = useDispatch();
  const store = useStore();
  const { context } = useMapPanel();
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const [activeFilterId, setActiveFilterId] = useState<string | null>(
    existingFilterId,
  );
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
  const initialSelectionKey = normalizedIds(initialLayerIds).join("|");

  useEffect(() => {
    const filterable = new Set(filterableLayerIds);
    const hasExplicitInitialSelection = initialLayerIds !== null;
    const initialSelection = hasExplicitInitialSelection
      ? normalizedIds(initialLayerIds).filter((id) => filterable.has(id))
      : filterableLayerIds;

    setSelectedLayerIds(initialSelection);
    setAppliedLayerIds(existingFilterId ? initialSelection : []);
    setActiveFilterId(existingFilterId);
    setStatus(null);
  }, [
    existingFilterId,
    feature?.id,
    initialLayerIds,
    initialSelectionKey,
    selectionKey,
  ]);

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

    const result = activeFilterId
      ? updateGeometryFilterLayers({
          dispatch: (action) => dispatch(action as any),
          getState: () => store.getState(),
          filterId: activeFilterId,
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

    const value = result.value;
    if (!value) {
      setStatus({
        tone: "error",
        text: "O engine não retornou o estado atualizado do filtro geométrico.",
      });
      telemetry("map_panel_command_denied", "COMMAND_FAILED");
      return;
    }

    setActiveFilterId(value.filterId);
    setAppliedLayerIds(value.affectedLayerIds);
    setSelectedLayerIds(value.affectedLayerIds);
    setStatus({
      tone: "success",
      text: `Filtro aplicado em ${value.affectedLayerIds.length} camada(s).`,
    });
    telemetry(
      "map_panel_command_executed",
      activeFilterId ? "GEOMETRY_FILTER_UPDATED" : "GEOMETRY_FILTER_CREATED",
    );
    onApplied?.(value);
  }

  function removeCurrentFilter() {
    if (!activeFilterId) return;
    setStatus(null);

    if (!authorization.ok) {
      setStatus({ tone: "error", text: authorization.reason });
      telemetry("map_panel_command_denied", authorization.code);
      return;
    }

    const id = activeFilterId;
    const result = removeGeometryFilter({
      dispatch: (action) => dispatch(action as any),
      getState: () => store.getState(),
      filterId: id,
    });

    if (!result.ok) {
      setStatus({ tone: "error", text: result.reason });
      telemetry("map_panel_command_denied", result.code);
      return;
    }

    setActiveFilterId(null);
    setAppliedLayerIds([]);
    setStatus({ tone: "success", text: "Filtro geométrico removido." });
    telemetry("map_panel_command_executed", "GEOMETRY_FILTER_REMOVED");
    onRemoved?.(id);
    onExit?.();
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
                : "Selecione pelo menos uma camada ou remova o filtro.")}
        </p>
        <div className="maono-map-tooltip__filter-actions">
          {onExit ? (
            <button
              type="button"
              className="maono-map-tooltip__exit-filter"
              onClick={onExit}
            >
              Sair do filtro por geometria
            </button>
          ) : null}
          {activeFilterId ? (
            <button
              type="button"
              className="maono-map-tooltip__remove-filter"
              onClick={removeCurrentFilter}
              disabled={!authorization.ok}
            >
              Remover filtro
            </button>
          ) : null}
          <button
            type="button"
            className="maono-map-tooltip__apply"
            onClick={applySelection}
            disabled={!canApply}
          >
            {activeFilterId ? "Atualizar filtro" : "Aplicar filtro"}
          </button>
        </div>
      </div>
    </section>
  );
}
