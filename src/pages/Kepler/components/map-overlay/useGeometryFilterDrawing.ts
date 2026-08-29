import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Feature } from "@kepler.gl/types";

import type { MapViewportSummary } from "../../engine-adapter/types";
import {
  markerOriginToScreen,
  screenToMarkerOrigin,
  type MapCanvasRect,
  type MarkerOrigin,
} from "./marker-projection";

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

function isInteractiveTarget(target: EventTarget | null) {
  return Boolean(
    target instanceof Element &&
      target.closest(
        "button, a, input, select, textarea, [role='button'], [role='menu'], [role='dialog'], [data-maono-no-preview='true']",
      ),
  );
}

function createFeatureId() {
  if (
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return `maono-geometry-filter-${globalThis.crypto.randomUUID()}`;
  }

  return `maono-geometry-filter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createGeometryFilterFeature(
  points: MarkerOrigin[],
): Feature | null {
  if (points.length < 3) return null;

  const coordinates = points.map((point) => [point.longitude, point.latitude]);
  coordinates.push([...coordinates[0]]);

  return {
    type: "Feature",
    id: createFeatureId(),
    properties: {
      isClosed: true,
      maonoGeometryFilter: true,
    },
    geometry: {
      type: "Polygon",
      coordinates: [coordinates],
    },
  } as Feature;
}

export function useGeometryFilterDrawing(
  viewport: MapViewportSummary | null,
  canvasRect: MapCanvasRect | null,
) {
  const [active, setActive] = useState(false);
  const [points, setPoints] = useState<MarkerOrigin[]>([]);
  const suppressNextClickRef = useRef(false);

  const start = useCallback(() => {
    setPoints([]);
    setActive(true);
  }, []);

  const cancel = useCallback(() => {
    setActive(false);
    setPoints([]);
  }, []);

  const undo = useCallback(() => {
    setPoints((current) => current.slice(0, -1));
  }, []);

  const finish = useCallback(() => {
    const feature = createGeometryFilterFeature(points);
    if (!feature) return null;

    setActive(false);
    setPoints([]);
    return feature;
  }, [points]);

  useEffect(() => {
    if (!active || !canvasRect || typeof window === "undefined") {
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
        !pointInsideCanvas(event.clientX, event.clientY, canvasRect) ||
        isInteractiveTarget(event.target)
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
        !pointInsideCanvas(event.clientX, event.clientY, canvasRect) ||
        isInteractiveTarget(event.target)
      ) {
        return;
      }

      const point = screenToMarkerOrigin(
        event.clientX,
        event.clientY,
        canvasRect,
        viewport,
      );
      if (!point) return;

      setPoints((currentPoints) => [...currentPoints, point]);
      suppressNextClickRef.current = true;
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
  }, [active, canvasRect, viewport]);

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

  useEffect(() => {
    if (!active || typeof window === "undefined") return undefined;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
        return;
      }

      if (event.key === "Backspace" && points.length) {
        const target = event.target;
        if (
          target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          (target instanceof HTMLElement && target.isContentEditable)
        ) {
          return;
        }

        event.preventDefault();
        undo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [active, cancel, points.length, undo]);

  const screenPoints = useMemo(() => {
    if (!canvasRect) return [];

    return points.flatMap((point) => {
      const position = markerOriginToScreen(point, canvasRect, viewport);
      if (!position) return [];

      return [
        {
          x: position.left - canvasRect.left,
          y: position.top - canvasRect.top,
        },
      ];
    });
  }, [canvasRect, points, viewport]);

  return {
    active,
    points,
    screenPoints,
    canFinish: points.length >= 3,
    start,
    cancel,
    undo,
    finish,
  };
}
