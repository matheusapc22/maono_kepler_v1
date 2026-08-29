// SPDX-License-Identifier: MIT
// @ts-nocheck

import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  MapPopoverFactory,
  getSelectedFeature,
} from "@kepler.gl/components";

import GeometryFilterMenu from "../components/map-overlay/GeometryFilterMenu";
import { isPolygonGeometryFeature } from "../engine-adapter/geometry-filter-command.ts";
import "./maono-map-popover.css";
import "../components/map-overlay/geometry-filter-ui.css";

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
  const estimatedHeight = expanded ? 560 : 260;
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

MaonoMapPopoverFactory.deps = MapPopoverFactory.deps;

/**
 * Tooltip visual próprio da Maõno. O conteúdo configurado de atributos ainda
 * vem do Kepler, mas o shell e a gestão do Polygon Filter pertencem à Maõno.
 * A filtragem espacial fica recolhida até o usuário acionar explicitamente
 * "Filtrar por geometria".
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
    const [filterMenuOpen, setFilterMenuOpen] = useState(false);
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
      expanded: canManageGeometry && filterMenuOpen,
    });

    if (typeof document === "undefined") return null;

    const root = container?.ownerDocument?.body ?? document.body;

    return createPortal(
      <aside
        className={`maono-map-tooltip${frozen ? " is-frozen" : " is-hover"}${filterMenuOpen ? " has-geometry-menu" : ""}`}
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
            <div className="maono-map-tooltip__geometry-action">
              <button
                type="button"
                className={filterMenuOpen ? "is-open" : ""}
                onClick={() => setFilterMenuOpen((current) => !current)}
                aria-haspopup="menu"
                aria-expanded={filterMenuOpen}
              >
                <GeometryFilterIcon />
                <span>Filtrar por geometria</span>
                <b aria-hidden="true">{filterMenuOpen ? "⌃" : "⌄"}</b>
              </button>

              {filterMenuOpen ? (
                <div
                  className="maono-map-tooltip__geometry-dropdown"
                  role="menu"
                  aria-label="Filtragem espacial"
                >
                  <GeometryFilterMenu
                    feature={feature}
                    sourceLayerId={sourceLayerId}
                  />
                </div>
              ) : null}
            </div>
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
