// SPDX-License-Identifier: MIT
// @ts-nocheck

import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useDispatch, useStore } from "react-redux";

import {
  MapPopoverFactory,
  getSelectedFeature,
} from "@kepler.gl/components";

import {
  applyGeometryFilter,
  geometryFilterLayerOptions,
  isPolygonGeometryFeature,
  updateGeometryFilterLayers,
} from "../engine-adapter/geometry-filter-command.ts";
import { authorizeMapPanelCommand } from "../map-panel/map-panel-capabilities.ts";
import { emitMapPanelTelemetry } from "../map-panel/map-panel-telemetry.ts";
import { useMapPanel } from "../map-panel/MapPanelContext.tsx";
import "./maono-map-popover.css";

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

function tooltipPosition({ x, y, container, expanded }) {
  const bounds = container?.getBoundingClientRect?.();
  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280;
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
  const anchorX = (bounds?.left || 0) + Number(x || 0);
  const anchorY = (bounds?.top || 0) + Number(y || 0);
  const estimatedWidth = expanded ? 390 : 320;
  const estimatedHeight = expanded ? 560 : 230;
  const gap = 16;

  const placeLeft = anchorX + gap + estimatedWidth > viewportWidth - 12;
  const left = placeLeft
    ? anchorX - estimatedWidth - gap
    : anchorX + gap;
  const top = clamp(
    anchorY + 12,
    12,
    Math.max(12, viewportHeight - estimatedHeight - 12),
  );

  return {
    left: clamp(left, 12, Math.max(12, viewportWidth - estimatedWidth - 12)),
    top,
  };
}

function layerName(layerHoverProp) {
  return String(
    layerHoverProp?.layer?.config?.label ??
      layerHoverProp?.layer?.id ??
      "Camada",
  );
}

function sameLayerSelection(left, right) {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  return right.every((id) => leftSet.has(id));
}

function GeometryFilterManager({ feature, sourceLayerId }) {
  const dispatch = useDispatch();
  const store = useStore();
  const { context } = useMapPanel();
  const [selectedLayerIds, setSelectedLayerIds] = useState([]);
  const [filterId, setFilterId] = useState(null);
  const [appliedLayerIds, setAppliedLayerIds] = useState([]);
  const [status, setStatus] = useState(null);

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

  function telemetry(event, code = null) {
    emitMapPanelTelemetry(event, {
      mode: context?.mode ?? null,
      projectId: context?.project?.id ?? null,
      organizationId: context?.organization?.id ?? null,
      policyVersion: context?.policyVersion ?? null,
      command: "filterByGeometry",
      capability: "editFilters",
      code,
      source: "maono-geometry-tooltip",
    });
  }

  function toggleLayer(id) {
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
          dispatch: (action) => dispatch(action),
          getState: () => store.getState(),
          filterId,
          targetLayerIds: selectedLayerIds,
        })
      : applyGeometryFilter({
          dispatch: (action) => dispatch(action),
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

    setFilterId(result.value.filterId);
    setAppliedLayerIds(result.value.affectedLayerIds);
    setSelectedLayerIds(result.value.affectedLayerIds);
    setStatus({
      tone: "success",
      text: `Filtro aplicado em ${result.value.affectedLayerIds.length} camada(s).`,
    });
    telemetry("map_panel_command_executed", filterId ? "GEOMETRY_FILTER_UPDATED" : "GEOMETRY_FILTER_CREATED");
  }

  return (
    <section
      className="maono-map-tooltip__filter-manager"
      aria-label="Gestão de filtragem por geometria"
    >
      <div className="maono-map-tooltip__filter-title">
        <div>
          <small>Filtragem espacial</small>
          <strong>Aplicar esta geometria às camadas</strong>
          <span>
            Selecione exatamente quais camadas devem responder a este polígono.
          </span>
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

MaonoMapPopoverFactory.deps = MapPopoverFactory.deps;

/**
 * Tooltip Maõno independente do MapPopover visual e do FeatureActionPanel do
 * Kepler. O Kepler fornece apenas o conteúdo configurado e o Polygon Filter
 * como engine; posição, shell, seleção de camadas e gestão pertencem à Maõno.
 */
export function MaonoMapPopoverFactory(MapPopoverContent) {
  const MaonoMapPopover = ({
    x,
    y,
    frozen,
    coordinate,
    layerHoverProp,
    isBase,
    zoom,
    container,
    onClose,
  }) => {
    const feature = useMemo(
      () => (frozen ? getSelectedFeature(layerHoverProp) : null),
      [frozen, layerHoverProp],
    );
    const sourceLayerId = String(layerHoverProp?.layer?.id ?? "").trim() || null;
    const canManageGeometry = Boolean(
      frozen && feature && isPolygonGeometryFeature(feature),
    );
    const position = tooltipPosition({
      x,
      y,
      container,
      expanded: canManageGeometry,
    });

    if (typeof document === "undefined") return null;

    const root = container?.ownerDocument?.body ?? document.body;

    return createPortal(
      <aside
        className={`maono-map-tooltip${frozen ? " is-frozen" : " is-hover"}`}
        style={position}
        aria-label={`Informações da camada ${layerName(layerHoverProp)}`}
      >
        <header className="maono-map-tooltip__header">
          <span className="maono-map-tooltip__heading">
            <small>{isBase ? "Camada principal" : frozen ? "Seleção" : "Informação"}</small>
            <strong>{layerName(layerHoverProp)}</strong>
          </span>
          {frozen ? (
            <button
              type="button"
              className="maono-map-tooltip__close"
              onClick={onClose}
              aria-label="Fechar tooltip"
            >
              ×
            </button>
          ) : null}
        </header>

        <div className="maono-map-tooltip__body">
          <div className="maono-map-tooltip__content">
            <MapPopoverContent
              coordinate={coordinate}
              zoom={zoom}
              layerHoverProp={layerHoverProp}
            />
          </div>

          {canManageGeometry ? (
            <GeometryFilterManager
              feature={feature}
              sourceLayerId={sourceLayerId}
            />
          ) : null}
        </div>
      </aside>,
      root,
    );
  };

  MaonoMapPopover.displayName = "MaonoMapPopover";
  return MaonoMapPopover;
}

export function replaceMapPopover() {
  return [MapPopoverFactory, MaonoMapPopoverFactory];
}
