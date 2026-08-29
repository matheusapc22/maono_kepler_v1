import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useSelector, useStore } from "react-redux";

import {
  geometryFilterSnapshots,
  type GeometryFilterSnapshot,
} from "../../engine-adapter/geometry-filter-command";
import {
  readValue,
  selectKeplerVisState,
} from "../../engine-adapter/selectors";
import { useKeplerEngineAdapter } from "../../engine-adapter";
import { useMapPanel } from "../../map-panel/MapPanelContext";
import GeometryFilterMenu from "./GeometryFilterMenu";
import {
  hitTestProjectedGeometry,
  projectGeometryFilter,
  type ProjectedGeometryFilter,
} from "./geometry-filter-overlay-utils";
import { useGeometryFilterManager } from "./useGeometryFilterManager";
import { useMapCanvasRect } from "./useMapCanvasRect";
import "./geometry-filter-ui.css";

type ProjectedSnapshot = {
  snapshot: GeometryFilterSnapshot;
  geometry: ProjectedGeometryFilter;
};

function pointInsideRect(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
) {
  return (
    clientX >= rect.left &&
    clientX <= rect.left + rect.width &&
    clientY >= rect.top &&
    clientY <= rect.top + rect.height
  );
}

function interactiveTarget(target: EventTarget | null) {
  return Boolean(
    target instanceof Element &&
      target.closest(
        "button, a, input, select, textarea, [role='button'], [role='menu'], [role='dialog'], [data-maono-no-preview='true']",
      ),
  );
}

/**
 * Runtime visual proprietário dos Polygon Filters.
 *
 * O Kepler continua calculando quais registros pertencem à geometria, mas não
 * desenha, seleciona ou recebe interação sobre ela. A Maõno projeta a mesma
 * geometria em SVG, faz apenas o hit-test de UI e abre o próprio gestor.
 */
export default function MaonoGeometryFilterRuntime() {
  const store = useStore();
  const { state } = useKeplerEngineAdapter();
  const { context, customMapOverlayEnabled } = useMapPanel();
  const canvasRect = useMapCanvasRect();
  const [modeActive, setModeActive] = useState(false);
  const [managedFilterId, setManagedFilterId] = useState<string | null>(null);
  const suppressNextClickRef = useRef(false);

  // O isolamento fica montado durante todo o runtime, não apenas enquanto um
  // menu está aberto. Isso impede que ações internas do Kepler reativem o
  // EditableGeoJsonLayer entre duas interações Maõno.
  useGeometryFilterManager({ enabled: customMapOverlayEnabled });

  const rawFilters = useSelector((rootState: unknown) =>
    readValue(selectKeplerVisState(rootState), "filters"),
  );
  const snapshots = useMemo(
    () =>
      geometryFilterSnapshots(store.getState()).filter(
        (filter) => filter.enabled,
      ),
    [rawFilters, store],
  );
  const projectedFilters = useMemo<ProjectedSnapshot[]>(() => {
    if (!state.viewport || !canvasRect) return [];

    return snapshots.flatMap((snapshot) => {
      const geometry = projectGeometryFilter(
        snapshot.feature,
        state.viewport,
        canvasRect,
      );
      return geometry ? [{ snapshot, geometry }] : [];
    });
  }, [canvasRect, snapshots, state.viewport]);
  const managedSnapshot =
    snapshots.find((filter) => filter.id === managedFilterId) ?? null;
  const canManage = context?.capabilities.editFilters === true;

  function exitGeometryFilterMode() {
    setManagedFilterId(null);
    setModeActive(false);
  }

  useEffect(() => {
    if (!managedFilterId) return;
    if (!snapshots.some((filter) => filter.id === managedFilterId)) {
      setManagedFilterId(null);
    }
  }, [managedFilterId, snapshots]);

  useEffect(() => {
    if (!snapshots.length) {
      setManagedFilterId(null);
      setModeActive(false);
    }
  }, [snapshots.length]);

  useEffect(() => {
    if (canManage) return;
    setManagedFilterId(null);
    setModeActive(false);
  }, [canManage]);

  useEffect(() => {
    if (!modeActive || typeof window === "undefined") return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      exitGeometryFilterMode();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [modeActive]);

  useEffect(() => {
    if (
      !modeActive ||
      !canManage ||
      !canvasRect ||
      !projectedFilters.length ||
      typeof window === "undefined"
    ) {
      return undefined;
    }

    let pointer:
      | {
          id: number;
          startX: number;
          startY: number;
          moved: boolean;
        }
      | null = null;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        interactiveTarget(event.target) ||
        !pointInsideRect(event.clientX, event.clientY, canvasRect)
      ) {
        return;
      }

      pointer = {
        id: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      if (
        Math.hypot(
          event.clientX - pointer.startX,
          event.clientY - pointer.startY,
        ) > 6
      ) {
        pointer.moved = true;
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      const current = pointer;
      pointer = null;
      if (
        !current ||
        current.id !== event.pointerId ||
        current.moved ||
        interactiveTarget(event.target) ||
        !pointInsideRect(event.clientX, event.clientY, canvasRect)
      ) {
        return;
      }

      const localPoint = {
        x: event.clientX - canvasRect.left,
        y: event.clientY - canvasRect.top,
      };
      const hit = [...projectedFilters]
        .reverse()
        .find((candidate) =>
          hitTestProjectedGeometry(candidate.geometry, localPoint),
        );

      if (!hit) {
        setManagedFilterId(null);
        return;
      }

      setManagedFilterId(hit.snapshot.id);
      suppressNextClickRef.current = true;
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (pointer?.id === event.pointerId) pointer = null;
    };

    const handleClick = (event: MouseEvent) => {
      if (!suppressNextClickRef.current) return;
      suppressNextClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("click", handleClick, true);

    return () => {
      pointer = null;
      suppressNextClickRef.current = false;
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("click", handleClick, true);
    };
  }, [canManage, canvasRect, modeActive, projectedFilters]);

  if (
    !customMapOverlayEnabled ||
    !canvasRect ||
    !state.viewport ||
    typeof document === "undefined"
  ) {
    return null;
  }

  return createPortal(
    <>
      {projectedFilters.length ? (
        <svg
          className={`maono-geometry-filter-overlay${modeActive ? " is-management-mode" : ""}`}
          style={{
            left: canvasRect.left,
            top: canvasRect.top,
            width: canvasRect.width,
            height: canvasRect.height,
          }}
          viewBox={`0 0 ${canvasRect.width} ${canvasRect.height}`}
          aria-hidden="true"
          data-maono-no-preview="true"
        >
          {projectedFilters.map(({ snapshot, geometry }) => (
            <path
              key={snapshot.id}
              d={geometry.path}
              fillRule="evenodd"
              className={`${snapshot.id === managedFilterId ? "is-managed" : ""}${snapshot.maonoManaged ? " is-maono" : " is-legacy"}`}
            />
          ))}
        </svg>
      ) : null}

      {projectedFilters.length && canManage ? (
        <div
          className="maono-geometry-runtime-controls"
          data-maono-no-preview="true"
        >
          <button
            type="button"
            className={modeActive ? "is-active" : ""}
            onClick={() => {
              if (modeActive) {
                exitGeometryFilterMode();
              } else {
                setManagedFilterId(null);
                setModeActive(true);
              }
            }}
            aria-pressed={modeActive}
          >
            {modeActive
              ? "Sair do filtro por geometria"
              : "Gerenciar filtros geométricos"}
          </button>
          {modeActive ? (
            <small>
              Clique em uma área dourada para gerenciar. Sair não remove filtros ativos.
            </small>
          ) : null}
        </div>
      ) : null}

      {modeActive && managedSnapshot ? (
        <section
          className="maono-geometry-runtime-manager"
          aria-label="Gerenciar filtro por geometria"
          data-maono-no-preview="true"
        >
          <header>
            <span>
              <small>Filtro por geometria</small>
              <strong>Área de filtragem</strong>
              <em>
                {managedSnapshot.layerIds.length} camada(s) associada(s)
              </em>
            </span>
            <button
              type="button"
              onClick={exitGeometryFilterMode}
              aria-label="Sair do filtro por geometria"
            >
              ×
            </button>
          </header>
          <div className="maono-geometry-runtime-manager__body">
            <GeometryFilterMenu
              feature={managedSnapshot.feature}
              sourceLayerId={managedSnapshot.sourceLayerId}
              existingFilterId={managedSnapshot.id}
              initialLayerIds={managedSnapshot.layerIds}
              title="Gerenciar área de filtragem"
              description="Altere as camadas afetadas, remova o filtro ou saia do modo de gestão sem alterar o filtro aplicado."
              onExit={exitGeometryFilterMode}
              onRemoved={() => setManagedFilterId(null)}
            />
          </div>
        </section>
      ) : null}
    </>,
    document.body,
  );
}
