import { useEffect } from "react";
import { useDispatch, useStore } from "react-redux";

import { setSelectedFeature, wrapTo } from "@kepler.gl/actions";
import { FILTER_TYPES } from "@kepler.gl/constants";

import {
  KEPLER_MAP_ID,
  collectionToArray,
  readValue,
  selectKeplerVisState,
} from "../../engine-adapter/selectors";

const DECK_SURFACE_IDS = new Set([
  "default-deckgl-overlay-wrapper",
  "default-deckgl-overlay",
]);

function deckSurfaceFromClick(event: MouseEvent) {
  if (typeof event.composedPath !== "function") return null;

  const path = event.composedPath();
  const surface = path.find(
    (node) =>
      node instanceof HTMLElement && DECK_SURFACE_IDS.has(node.id),
  );
  return surface instanceof HTMLElement ? surface : null;
}

function selectedPolygonFilterId(rootState: unknown) {
  const visState = selectKeplerVisState(rootState);
  const editor = readValue(visState, "editor");
  const selectedFeature = readValue(editor, "selectedFeature");
  const properties = readValue(selectedFeature, "properties");
  const selectedFilterId = String(
    readValue(properties, "filterId") ?? "",
  ).trim();

  if (!selectedFilterId) return null;

  const filters = collectionToArray<any>(readValue(visState, "filters"));
  const match = filters.find(
    (filter) =>
      String(readValue(filter, "id") ?? "").trim() === selectedFilterId &&
      readValue(filter, "type") === FILTER_TYPES.polygon,
  );

  return match ? selectedFilterId : null;
}

/**
 * A gestão nativa foi removida. Este hook existe apenas como guarda visual:
 * se o Editor do Kepler selecionar um Polygon Filter após um clique no mapa,
 * a seleção é limpa antes do próximo paint. Assim os pontos azuis de edição e
 * o tooltip "Drag to move the point" não fazem parte da experiência Maõno.
 */
export function useGeometryFilterManager({
  enabled = true,
}: {
  enabled?: boolean;
} = {}) {
  const dispatch = useDispatch();
  const store = useStore();

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;

    let pendingFrame = 0;

    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0 || !deckSurfaceFromClick(event)) return;

      window.cancelAnimationFrame(pendingFrame);
      pendingFrame = window.requestAnimationFrame(() => {
        if (!selectedPolygonFilterId(store.getState())) return;

        dispatch(
          wrapTo(KEPLER_MAP_ID, setSelectedFeature(null)) as any,
        );
      });
    };

    window.addEventListener("click", handleClick, true);
    return () => {
      window.cancelAnimationFrame(pendingFrame);
      window.removeEventListener("click", handleClick, true);
    };
  }, [dispatch, enabled, store]);
}
