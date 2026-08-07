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

function mapCanvas() {
  return document.querySelector(".mapboxgl-canvas") as HTMLElement | null;
}

function canvasRect(): MapCanvasRect | null {
  const rect = mapCanvas()?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

export function useMapMarker(viewport: MapViewportSummary | null) {
  const [placing, setPlacing] = useState(false);
  const [origin, setOrigin] = useState<MarkerOrigin | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [rect, setRect] = useState<MapCanvasRect | null>(null);
  const draggingPointerRef = useRef<number | null>(null);
  const movedRef = useRef(false);
  const observedCanvasRef = useRef<HTMLElement | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const refreshCanvas = useCallback(() => {
    const canvas = mapCanvas();

    if (canvas !== observedCanvasRef.current) {
      resizeObserverRef.current?.disconnect();
      observedCanvasRef.current = canvas;

      if (canvas && typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => setRect(canvasRect()));
        observer.observe(canvas);
        resizeObserverRef.current = observer;
      } else {
        resizeObserverRef.current = null;
      }
    }

    setRect(canvasRect());
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;

    refreshCanvas();
    const mutationObserver = new MutationObserver(refreshCanvas);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
    window.addEventListener("resize", refreshCanvas);
    window.addEventListener("scroll", refreshCanvas, true);
    const animationFrame = window.requestAnimationFrame(refreshCanvas);

    return () => {
      mutationObserver.disconnect();
      resizeObserverRef.current?.disconnect();
      resizeObserverRef.current = null;
      observedCanvasRef.current = null;
      window.cancelAnimationFrame(animationFrame);
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
    setOrigin(null);
    setMenuOpen(false);
  }, []);

  const cancelPlacement = useCallback(() => {
    setPlacing(false);
  }, []);

  useEffect(() => {
    if (!placing) return undefined;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelPlacement();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [cancelPlacement, placing]);

  const startPlacement = useCallback(() => {
    setOrigin(null);
    setMenuOpen(false);
    setPlacing(true);
  }, []);

  const placeAt = useCallback(
    (clientX: number, clientY: number) => {
      const next = screenToMarkerOrigin(clientX, clientY, rect, viewport);
      if (!next) return false;

      setOrigin(next);
      setPlacing(false);
      setMenuOpen(true);
      return true;
    },
    [rect, viewport],
  );

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
