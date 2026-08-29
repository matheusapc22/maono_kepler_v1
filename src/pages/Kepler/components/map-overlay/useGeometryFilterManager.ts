import { useEffect } from "react";
import { useDispatch, useStore } from "react-redux";

import { openSelectedGeometryFilterManager } from "../../engine-adapter/geometry-filter-command.ts";
import { authorizeMapPanelCommand } from "../../map-panel/map-panel-capabilities.ts";
import { emitMapPanelTelemetry } from "../../map-panel/map-panel-telemetry.ts";
import { useMapPanel } from "../../map-panel/MapPanelContext.tsx";

const DECK_SURFACE_IDS = new Set([
  "default-deckgl-overlay-wrapper",
  "default-deckgl-overlay",
]);

function deckSurfaceFromClick(event: MouseEvent) {
  if (typeof event.composedPath !== "function") return null;

  const path = event.composedPath();
  const wrapper = path.find(
    (node) =>
      node instanceof HTMLElement &&
      node.id === "default-deckgl-overlay-wrapper",
  );
  if (wrapper instanceof HTMLElement) return wrapper;

  const overlay = path.find(
    (node) => node instanceof HTMLElement && DECK_SURFACE_IDS.has(node.id),
  );
  return overlay instanceof HTMLElement ? overlay : null;
}

export function useGeometryFilterManager({
  enabled = true,
}: {
  enabled?: boolean;
} = {}) {
  const dispatch = useDispatch();
  const store = useStore();
  const { context } = useMapPanel();

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;

    const authorization = authorizeMapPanelCommand(
      context?.capabilities,
      "filterByGeometry",
      "editFilters",
    );
    if (!authorization.ok) return undefined;

    let pendingFrame = 0;

    const handleMapClick = (event: MouseEvent) => {
      if (event.button !== 0) return;

      const surface = deckSurfaceFromClick(event);
      if (!surface) return;

      const rect = surface.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      const position = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };

      // O click nativo do Deck/Kepler seleciona primeiro a feição do Editor.
      // Abrimos o painel no frame seguinte para reutilizar essa seleção, sem
      // reimplementar picking ou Point-in-Polygon na camada Maõno.
      window.cancelAnimationFrame(pendingFrame);
      pendingFrame = window.requestAnimationFrame(() => {
        const result = openSelectedGeometryFilterManager({
          dispatch: (action) => dispatch(action as any),
          getState: () => store.getState(),
          position,
          mapIndex: 0,
        });

        if (!result.ok) return;

        emitMapPanelTelemetry("map_panel_command_executed", {
          mode: context?.mode ?? null,
          projectId: context?.project?.id ?? null,
          organizationId: context?.organization?.id ?? null,
          policyVersion: context?.policyVersion ?? null,
          command: "filterByGeometry",
          capability: "editFilters",
          code: "GEOMETRY_FILTER_MANAGER_OPENED",
          source: "maono-geometry-filter-manager",
        });
      });
    };

    window.addEventListener("click", handleMapClick, true);
    return () => {
      window.cancelAnimationFrame(pendingFrame);
      window.removeEventListener("click", handleMapClick, true);
    };
  }, [
    context?.capabilities,
    context?.mode,
    context?.organization?.id,
    context?.policyVersion,
    context?.project?.id,
    dispatch,
    enabled,
    store,
  ]);
}
