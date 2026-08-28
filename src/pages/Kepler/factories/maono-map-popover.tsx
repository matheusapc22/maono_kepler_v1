// SPDX-License-Identifier: MIT
// @ts-nocheck

import React, {
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";
import { useDispatch, useStore } from "react-redux";
import { createGlobalStyle, ThemeProvider } from "styled-components";

import {
  MapPopoverFactory,
  getSelectedFeature,
} from "@kepler.gl/components";

import {
  applyGeometryFilter,
  geometryFilterTargetLayerIds,
  isPolygonGeometryFeature,
} from "../engine-adapter/geometry-filter-command.ts";
import { authorizeMapPanelCommand } from "../map-panel/map-panel-capabilities.ts";
import { emitMapPanelTelemetry } from "../map-panel/map-panel-telemetry.ts";
import { useMapPanel } from "../map-panel/MapPanelContext.tsx";

const MaonoPopoverStableStyles = createGlobalStyle`
  .map-popover {
    min-width: 236px;
    border: 1px solid rgba(197, 160, 89, 0.46);
    border-radius: 16px;
    background-clip: padding-box;
    box-shadow:
      inset 0 1px rgba(255, 255, 255, 0.035),
      0 22px 52px rgba(0, 0, 0, 0.58);
    backdrop-filter: blur(16px);
    scrollbar-color: rgba(197, 160, 89, 0.72) transparent;
    scrollbar-width: thin;
  }

  .map-popover::-webkit-scrollbar {
    width: 4px;
    height: 4px;
  }

  .map-popover::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(197, 160, 89, 0.72);
  }

  .map-popover .popover-arrow-left,
  .map-popover .popover-arrow-right,
  .map-popover .popover-pin {
    display: grid;
    place-items: center;
    min-width: 24px;
    min-height: 24px;
    border-radius: 8px;
    color: #c5a059;
    transition:
      color 150ms ease,
      background 150ms ease,
      transform 150ms ease;
  }

  .map-popover .popover-arrow-left:hover,
  .map-popover .popover-arrow-right:hover,
  .map-popover .popover-pin:hover {
    color: #f1d28a;
    background: rgba(197, 160, 89, 0.11);
    transform: translateY(-1px);
  }

  .map-popover .primary-label {
    color: #d9b96e;
    font-size: 9px;
    font-weight: 850;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .map-popover .map-popover__layer-info,
  .map-popover .coordingate-hover-info {
    padding: 2px 0;
  }

  .map-popover .map-popover__layer-info > table,
  .map-popover .coordingate-hover-info > table {
    width: 100%;
    column-gap: 14px;
    row-gap: 7px;
  }

  .map-popover td {
    color: #8797ad;
    font-size: 10px;
    line-height: 1.35;
  }

  .map-popover td.row__value {
    color: #f8fafc;
    font-weight: 650;
  }

  .map-popover .select-geometry {
    display: none;
  }

  .maono-map-popover__geometry-filter {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid rgba(197, 160, 89, 0.2);
  }

  .maono-map-popover__geometry-filter button {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
    width: 100%;
    min-height: 34px;
    padding: 7px 9px;
    border: 1px solid rgba(197, 160, 89, 0.3);
    border-radius: 10px;
    color: #f7f2e8;
    background: rgba(197, 160, 89, 0.075);
    cursor: pointer;
    font: inherit;
    font-size: 10px;
    font-weight: 780;
    letter-spacing: 0.015em;
    text-align: left;
    transition:
      border-color 150ms ease,
      color 150ms ease,
      background 150ms ease,
      transform 150ms ease;
  }

  .maono-map-popover__geometry-filter button:hover:not(:disabled) {
    border-color: rgba(197, 160, 89, 0.72);
    color: #f1d28a;
    background: rgba(197, 160, 89, 0.13);
    transform: translateY(-1px);
  }

  .maono-map-popover__geometry-filter button:focus-visible {
    outline: 2px solid #f1d28a;
    outline-offset: 2px;
  }

  .maono-map-popover__geometry-filter button:disabled {
    cursor: not-allowed;
    opacity: 0.48;
  }

  .maono-map-popover__geometry-filter svg {
    width: 16px;
    height: 16px;
    flex: 0 0 auto;
    color: #c5a059;
  }

  .maono-map-popover__geometry-filter-error {
    margin: 7px 2px 0;
    color: #fecdd3;
    font-size: 9px;
    line-height: 1.35;
  }
`;

function maonoPopoverTheme(outerTheme = {}) {
  return {
    ...outerTheme,
    activeColor: "#c5a059",
    linkBtnColor: "#f1d28a",
    labelColor: "#8797ad",
    textColor: "#e6edf6",
    textColorHl: "#f8fafc",
    panelBackground: "rgba(8, 12, 19, 0.97)",
    panelBorderColor: "rgba(197, 160, 89, 0.2)",
    panelBoxShadow: "0 22px 52px rgba(0, 0, 0, 0.58)",
    notificationColors: {
      ...(outerTheme.notificationColors || {}),
      success: "#d9b96e",
    },
  };
}

const MaonoMapPopoverActionContext = createContext({
  frozen: false,
  onClose: () => {},
});

function GeometryFilterIcon() {
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
      <path d="M4 6.5 9 3l5 2 6-2v14.5L15 21l-5-2-6 2V6.5Z" />
      <path d="M9 3v16M14 5v16" />
    </svg>
  );
}

function MaonoGeometryFilterAction({ layerHoverProp }) {
  const { frozen, onClose } = useContext(MaonoMapPopoverActionContext);
  const dispatch = useDispatch();
  const store = useStore();
  const { context } = useMapPanel();
  const [error, setError] = useState(null);

  const feature = useMemo(
    () => (frozen ? getSelectedFeature(layerHoverProp) : null),
    [frozen, layerHoverProp],
  );
  const sourceLayerId = String(layerHoverProp?.layer?.id ?? "").trim() || null;
  const targetLayerIds = geometryFilterTargetLayerIds(
    store.getState(),
    sourceLayerId,
  );

  if (!frozen || !feature || !isPolygonGeometryFeature(feature)) {
    return null;
  }

  const authorization = authorizeMapPanelCommand(
    context?.capabilities,
    "filterByGeometry",
    "editFilters",
  );
  const disabledReason = !authorization.ok
    ? authorization.reason
    : targetLayerIds.length === 0
      ? "Não há outra camada visível compatível com o filtro por geometria."
      : null;

  function telemetry(event, code = null) {
    emitMapPanelTelemetry(event, {
      mode: context?.mode ?? null,
      projectId: context?.project?.id ?? null,
      organizationId: context?.organization?.id ?? null,
      policyVersion: context?.policyVersion ?? null,
      command: "filterByGeometry",
      capability: "editFilters",
      code,
      source: "maono-map-popover",
    });
  }

  function filterByGeometry() {
    setError(null);

    if (!authorization.ok) {
      setError(authorization.reason);
      telemetry("map_panel_command_denied", authorization.code);
      return;
    }

    const result = applyGeometryFilter({
      dispatch,
      getState: () => store.getState(),
      feature,
      sourceLayerId,
    });

    if (!result.ok) {
      setError(result.reason);
      telemetry("map_panel_command_denied", result.code);
      return;
    }

    telemetry("map_panel_command_executed");
    onClose();
  }

  return (
    <div className="maono-map-popover__geometry-filter">
      <button
        type="button"
        onClick={filterByGeometry}
        disabled={Boolean(disabledReason)}
        title={disabledReason || "Filtrar camadas visíveis usando esta geometria"}
        aria-label="Filtrar por geometria"
      >
        <GeometryFilterIcon />
        <span>Filtrar por geometria</span>
      </button>
      {error ? (
        <p className="maono-map-popover__geometry-filter-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

MaonoMapPopoverFactory.deps = MapPopoverFactory.deps;

/**
 * Mantém o MapPopover e o MapPopoverContent oficiais do Kepler para hover,
 * pin, posicionamento, campos configurados e leitura de atributos. A extensão
 * Maõno injeta apenas uma ação semântica dentro do conteúdo e delega o filtro
 * espacial ao Polygon Filter nativo do Kepler.
 */
export function MaonoMapPopoverFactory(MapPopoverContent) {
  const MaonoMapPopoverContent = (props) => (
    <>
      <MapPopoverContent {...props} />
      <MaonoGeometryFilterAction layerHoverProp={props.layerHoverProp} />
    </>
  );
  MaonoMapPopoverContent.displayName = "MaonoMapPopoverContent";

  const NativeMapPopover = MapPopoverFactory(MaonoMapPopoverContent);

  const MaonoMapPopover = (props) => (
    <ThemeProvider theme={maonoPopoverTheme}>
      <MaonoMapPopoverActionContext.Provider
        value={{
          frozen: Boolean(props.frozen),
          onClose: props.onClose,
        }}
      >
        <MaonoPopoverStableStyles />
        <NativeMapPopover {...props} />
      </MaonoMapPopoverActionContext.Provider>
    </ThemeProvider>
  );

  MaonoMapPopover.displayName = "MaonoMapPopover";
  return MaonoMapPopover;
}

export function replaceMapPopover() {
  return [MapPopoverFactory, MaonoMapPopoverFactory];
}
