import { useCallback, useEffect, useState } from "react";

import type { MapCanvasRect } from "./marker-projection";

const MAP_SURFACE_SELECTORS = [
  "#default-deckgl-overlay-wrapper",
  "#default-deckgl-overlay",
  ".maplibregl-canvas",
  ".mapboxgl-canvas",
  ".maono-kepler-viewport canvas",
  ".maono-kepler-viewport",
] as const;

function sameRect(left: MapCanvasRect | null, right: MapCanvasRect | null) {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.left === right.left &&
    left.top === right.top &&
    left.width === right.width &&
    left.height === right.height
  );
}

export function findMapCanvasSurface() {
  if (typeof document === "undefined") return null;

  for (const selector of MAP_SURFACE_SELECTORS) {
    const candidates = document.querySelectorAll<HTMLElement>(selector);
    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return candidate;
    }
  }

  return null;
}

export function readMapCanvasRect(): MapCanvasRect | null {
  const rect = findMapCanvasSurface()?.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;

  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Fonte única para overlays visuais próprios da Maõno. A integração depende
 * somente da superfície estável do DeckGL/MapLibre e nunca inspeciona texto,
 * classes internas de tooltip ou a árvore do Editor do Kepler.
 */
export function useMapCanvasRect() {
  const [rect, setRect] = useState<MapCanvasRect | null>(null);

  const refresh = useCallback(() => {
    const next = readMapCanvasRect();
    setRect((current) => (sameRect(current, next) ? current : next));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    let surface = findMapCanvasSurface();
    let observer: ResizeObserver | null = null;
    let discoveryFrame = 0;
    let attempts = 0;

    const observeSurface = () => {
      const nextSurface = findMapCanvasSurface();
      if (nextSurface !== surface) {
        observer?.disconnect();
        observer = null;
        surface = nextSurface;
      }

      if (surface && !observer && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(refresh);
        observer.observe(surface);
      }

      refresh();
    };

    const discover = () => {
      observeSurface();
      if (!surface && attempts < 90) {
        attempts += 1;
        discoveryFrame = window.requestAnimationFrame(discover);
      }
    };

    const rediscover = () => {
      attempts = 0;
      window.cancelAnimationFrame(discoveryFrame);
      discover();
    };

    discover();
    window.addEventListener("maono:map-runtime", rediscover);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);

    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(discoveryFrame);
      window.removeEventListener("maono:map-runtime", rediscover);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [refresh]);

  return rect;
}
