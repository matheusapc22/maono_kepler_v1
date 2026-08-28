import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { MapViewportSummary } from "../../engine-adapter/types";
import {
  markerOriginToScreen,
  nudgeMarkerOrigin,
  screenToMarkerOrigin,
  type MapCanvasRect,
  type MarkerOrigin,
} from "./marker-projection";

export type MarkerPlacementKind = "marker" | "buffer" | "isochrone";

export const MAONO_MAP_PLACEMENT_POINT_EVENT = "maono:map-placement-point";

const MAP_SURFACE_SELECTORS = [
  ".maplibregl-canvas",
  ".mapboxgl-canvas",
  ".maono-kepler-viewport canvas",
  ".maono-kepler-viewport",
] as const;

const PLACEMENT_PIN_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24'%3E%3Cpath d='M12 24c0 0 9-7.4 9-14.5C21 4.25 16.97 0 12 0 7.03 0 3 4.25 3 9.5 3 16.6 12 24 12 24z' fill='%23C5A059' stroke='%230a0f18' stroke-width='1.5'/%3E%3Ccircle cx='12' cy='9' r='3' fill='%230a0f18'/%3E%3C/svg%3E\") 16 31, crosshair";

const PLACEMENT_CURSORS: Record<MarkerPlacementKind, string> = {
  marker: PLACEMENT_PIN_CURSOR,
  buffer: PLACEMENT_PIN_CURSOR,
  isochrone: PLACEMENT_PIN_CURSOR,
};

function mapSurface() {
  for (const selector of MAP_SURFACE_SELECTORS) {
    const candidates = document.querySelectorAll<HTMLElement>(selector);

    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return candidate;
    }
  }

  return null;
}

function canvasRect(): MapCanvasRect | null {
  const rect = mapSurface()?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function sameCanvasRect(
  current: MapCanvasRect | null,
  next: MapCanvasRect | null,
) {
  if (current === next) return true;
  if (!current || !next) return false;

  return (
    current.left === next.left &&
    current.top === next.top &&
    current.width === next.width &&
    current.height === next.height
  );
}

function pointInsideCanvas(
  clientX: number,
  clientY: number,
  rect: MapCanvasRect,
) {
  return (
    clientX >= rect.left &&
    clientX <= rect.left + rect.width &&
    clientY >= rect.top &&
    clientY <= rect.top + rect.height
  );
}

function isInteractivePlacementTarget(target: EventTarget | null) {
  return Boolean(
    target instanceof Element &&
      target.closest(
        "button, a, input, select, textarea, [role='button'], [role='menu'], [role='dialog']",
      ),
  );
}

export function useMapMarker(viewport: MapViewportSummary | null) {
  const [placing, setPlacing] = useState(false);
  const [placementKind, setPlacementKind] =
    useState<MarkerPlacementKind | null>(null);
  const [origin, setOrigin] = useState<MarkerOrigin | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [rect, setRect] = useState<MapCanvasRect | null>(null);
  const draggingPointerRef = useRef<number | null>(null);
  const movedRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const observedSurfaceRef = useRef<HTMLElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const refreshCanvas = useCallback(() => {
    const surface = mapSurface();

    if (surface !== observedSurfaceRef.current) {
      resizeObserverRef.current?.disconnect();
      observedSurfaceRef.current = surface;

      if (surface && typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => {
          const next = canvasRect();
          setRect((current) => (sameCanvasRect(current, next) ? current : next));
        });
        observer.observe(surface);
        resizeObserverRef.current = observer;
      } else {
        resizeObserverRef.current = null;
      }
    }

    const next = canvasRect();
    setRect((current) => (sameCanvasRect(current, next) ? current : next));
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    let discoveryFrame = 0;
    let discoveryAttempts = 0;

    const discoverCanvas = () => {
      refreshCanvas();
      if (!mapSurface() && discoveryAttempts < 90) {
        discoveryAttempts += 1;
        discoveryFrame = window.requestAnimationFrame(discoverCanvas);
      }
    };

    const handleMapRuntime = () => {
      discoveryAttempts = 0;
      window.cancelAnimationFrame(discoveryFrame);
      discoverCanvas();
    };

    discoverCanvas();
    window.addEventListener("maono:map-runtime", handleMapRuntime);
    window.addEventListener("resize", refreshCanvas);
    window.addEventListener("scroll", refreshCanvas, true);

    return () => {
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      observedSurfaceRef.current = null;
      window.cancelAnimationFrame(discoveryFrame);
      window.removeEventListener("maono:map-runtime", handleMapRuntime);
      window.removeEventListener("resize", refreshCanvas);
      window.removeEventListener("scroll", refreshCanvas, true);
    };
  }, [refreshCanvas]);

  useEffect(() => {
    refreshCanvas();
  }, [refreshCanvas, viewport?.height, viewport?.width]);

  const reset = useCallback(() => {
    draggingPointerRef.current = null;
    movedRef.current = false;
    setDragging(false);
    setPlacing(false);
    setPlacementKind(null);
    setOrigin(null);
    setMenuOpen(false);
  }, []);

  const cancelPlacement = useCallback(() => {
    setPlacing(false);
    setPlacementKind(null);
  }, []);

  useEffect(() => {
    if (!placing || !rect || typeof document === "undefined") return undefined;

    const visualOverlay = document.querySelector<HTMLElement>(
      ".maono-marker-placement",
    );
    const placementSurface = mapSurface();
    const previousPointerEvents = visualOverlay?.style.pointerEvents ?? "";
    const previousCursor = placementSurface?.style.cursor ?? "";

    if (visualOverlay) visualOverlay.style.pointerEvents = "none";
    if (placementSurface) {
      placementSurface.style.cursor = PLACEMENT_CURSORS[placementKind ?? "marker"];
    }

    return () => {
      if (visualOverlay) visualOverlay.style.pointerEvents = previousPointerEvents;
      if (placementSurface) placementSurface.style.cursor = previousCursor;
    };
  }, [placementKind, placing, rect]);

  const startPlacement = useCallback(
    (kind: MarkerPlacementKind = "marker") => {
      refreshCanvas();
      setOrigin(null);
      setMenuOpen(false);
      setPlacementKind(kind);
      setPlacing(true);
    },
    [refreshCanvas],
  );

  const placeAt = useCallback(
    (clientX: number, clientY: number): MarkerOrigin | null => {
      const next = screenToMarkerOrigin(clientX, clientY, rect, viewport);
      if (!next) return null;

      setOrigin(next);
      setPlacing(false);
      setPlacementKind(null);
      setMenuOpen(false);
      return next;
    },
    [rect, viewport],
  );

  useEffect(() => {
    if (!placing || !rect || typeof window === "undefined") return undefined;

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
        !pointInsideCanvas(event.clientX, event.clientY, rect) ||
        isInteractivePlacementTarget(event.target)
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
        !pointInsideCanvas(event.clientX, event.clientY, rect) ||
        isInteractivePlacementTarget(event.target)
      ) {
        return;
      }

      const next = placeAt(event.clientX, event.clientY);
      if (!next) return;

      suppressNextClickRef.current = true;
      window.dispatchEvent(
        new CustomEvent(MAONO_MAP_PLACEMENT_POINT_EVENT, {
          detail: next,
        }),
      );
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (pointer?.id === event.pointerId) pointer = null;
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    window.addEventListener("pointermove", handlePointerMove, true);
    window.addEventListener("pointerup", handlePointerUp, true);
    window.addEventListener("pointercancel", handlePointerCancel, true);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown, true);
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointerup", handlePointerUp, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
    };
  }, [placeAt, placing, rect]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const handleClick = (event: MouseEvent) => {
      if (!suppressNextClickRef.current) return;
      suppressNextClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("click", handleClick, true);
    return () => window.removeEventListener("click", handleClick, true);
  }, []);

  const position = useMemo(
    () => markerOriginToScreen(origin, rect, viewport),
    [origin, rect, viewport],
  );

  const beginDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId);
      draggingPointerRef.current = event.pointerId;
      movedRef.current = false;
      setDragging(true);
    },
    [],
  );

  const moveDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (draggingPointerRef.current !== event.pointerId) return;
      const next = screenToMarkerOrigin(
        event.clientX,
        event.clientY,
        rect,
        viewport,
      );
      if (!next) return;

      movedRef.current = true;
      setOrigin(next);
    },
    [rect, viewport],
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      draggingPointerRef.current = null;
      setDragging(false);
      setMenuOpen(true);
    },
    [],
  );

  const cancelDrag = useCallback(() => {
    draggingPointerRef.current = null;
    setDragging(false);
  }, []);

  const toggleMenuFromClick = useCallback(() => {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }
    setMenuOpen((current) => !current);
  }, []);

  const nudge = useCallback(
    (horizontalPixels: number, verticalPixels: number) => {
      const next = nudgeMarkerOrigin(
        origin,
        horizontalPixels,
        verticalPixels,
        viewport,
      );
      if (next) setOrigin(next);
    },
    [origin, viewport],
  );

  const handleMarkerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>) => {
      const step = event.shiftKey ? 30 : 10;
      const movements: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const movement = movements[event.key];

      if (movement) {
        event.preventDefault();
        nudge(...movement);
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        reset();
      }
    },
    [nudge, reset],
  );

  return {
    placing,
    placementKind,
    origin,
    menuOpen,
    dragging,
    canvasRect: rect,
    position,
    startPlacement,
    cancelPlacement,
    placeAt,
    reset,
    setMenuOpen,
    beginDrag,
    moveDrag,
    endDrag,
    cancelDrag,
    toggleMenuFromClick,
    handleMarkerKeyDown,
  };
}
