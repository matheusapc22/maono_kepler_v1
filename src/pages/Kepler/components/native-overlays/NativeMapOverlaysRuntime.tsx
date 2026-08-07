import { useEffect, useRef } from "react";

import { calculateNativeLegendPlacement } from "./native-overlay-placement";
import "./maono-native-overlays.css";

const LEGEND_SELECTORS = [
  ".map-legend",
  ".map-legend-panel",
  "[class*='map-legend']",
  "[class*='MapLegend']",
];

const ORIGINAL_STYLE_DATASET_KEY = "maonoNativeLegendOriginalStyle";

function visibleLegendCandidates() {
  const unique = new Set<HTMLElement>();

  for (const selector of LEGEND_SELECTORS) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width >= 120 && rect.height >= 48) {
        unique.add(element);
      }
    });
  }

  return [...unique];
}

function findNativeLegend() {
  const candidates = visibleLegendCandidates();

  return (
    candidates.find((element) =>
      /legenda|legend/i.test(element.textContent || ""),
    ) || candidates[0] || null
  );
}

function findLegendHost(legend: HTMLElement) {
  const explicitDraggable = legend.closest<HTMLElement>(
    ".react-draggable, [class*='draggable'], [class*='Draggable']",
  );
  if (explicitDraggable) return explicitDraggable;

  let current: HTMLElement | null = legend;
  for (let depth = 0; current && depth < 6; depth += 1) {
    const style = window.getComputedStyle(current);
    const transform = current.style.transform || style.transform;

    if (
      current !== legend &&
      (transform !== "none" ||
        style.position === "absolute" ||
        style.position === "fixed")
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return legend;
}

function mapCanvasRect() {
  return document
    .querySelector<HTMLElement>(".mapboxgl-canvas")
    ?.getBoundingClientRect() ?? null;
}

function rememberOriginalHostStyle(host: HTMLElement) {
  if (host.dataset[ORIGINAL_STYLE_DATASET_KEY]) return;

  host.dataset[ORIGINAL_STYLE_DATASET_KEY] = JSON.stringify({
    position: host.style.position,
    left: host.style.left,
    top: host.style.top,
    right: host.style.right,
    bottom: host.style.bottom,
    transform: host.style.transform,
  });
}

function restoreHostStyle(host: HTMLElement) {
  const serialized = host.dataset[ORIGINAL_STYLE_DATASET_KEY];
  if (!serialized) return;

  try {
    const original = JSON.parse(serialized) as Record<string, string>;
    host.style.position = original.position || "";
    host.style.left = original.left || "";
    host.style.top = original.top || "";
    host.style.right = original.right || "";
    host.style.bottom = original.bottom || "";
    host.style.transform = original.transform || "";
  } catch {
    host.style.removeProperty("position");
    host.style.removeProperty("left");
    host.style.removeProperty("top");
    host.style.removeProperty("right");
    host.style.removeProperty("bottom");
    host.style.removeProperty("transform");
  }

  delete host.dataset[ORIGINAL_STYLE_DATASET_KEY];
}

function positionLegend() {
  const legend = findNativeLegend();
  const mapRect = mapCanvasRect();
  if (!legend || !mapRect || mapRect.width <= 0 || mapRect.height <= 0) {
    return false;
  }

  const host = findLegendHost(legend);
  const legendRect = legend.getBoundingClientRect();
  const offsetParent = host.offsetParent as HTMLElement | null;
  const offsetParentRect = offsetParent?.getBoundingClientRect() ?? {
    left: 0,
    top: 0,
  };
  const placement = calculateNativeLegendPlacement(
    {
      left: mapRect.left,
      top: mapRect.top,
      width: mapRect.width,
      height: mapRect.height,
    },
    {
      width: legendRect.width,
      height: legendRect.height,
    },
    {
      left: offsetParentRect.left,
      top: offsetParentRect.top,
    },
  );
  const computed = window.getComputedStyle(host);

  rememberOriginalHostStyle(host);

  if (computed.position === "static") {
    host.style.position = "absolute";
  }
  host.style.left = `${placement.left}px`;
  host.style.top = `${placement.top}px`;
  host.style.right = "auto";
  host.style.bottom = "auto";
  host.style.transform = "translate3d(0px, 0px, 0px)";
  host.dataset.maonoNativeLegendHost = "true";
  host.dataset.maonoNativeLegendPositioned = "true";
  legend.dataset.maonoNativeLegend = "true";

  return true;
}

function restoreLegendRuntime() {
  document
    .querySelectorAll<HTMLElement>("[data-maono-native-legend-host]")
    .forEach((host) => {
      restoreHostStyle(host);
      delete host.dataset.maonoNativeLegendHost;
      delete host.dataset.maonoNativeLegendPositioned;
    });

  document
    .querySelectorAll<HTMLElement>("[data-maono-native-legend]")
    .forEach((legend) => {
      delete legend.dataset.maonoNativeLegend;
    });
}

export default function NativeMapOverlaysRuntime({
  legendVisible,
}: {
  legendVisible: boolean;
}) {
  const positionedForCurrentOpenRef = useRef(false);

  useEffect(() => {
    document.body.dataset.maonoNativeOverlays = "active";

    return () => {
      if (document.body.dataset.maonoNativeOverlays === "active") {
        delete document.body.dataset.maonoNativeOverlays;
      }
      restoreLegendRuntime();
    };
  }, []);

  useEffect(() => {
    if (!legendVisible) {
      positionedForCurrentOpenRef.current = false;
      restoreLegendRuntime();
      return undefined;
    }

    let animationFrame = 0;
    let timeoutId = 0;
    let observer: MutationObserver | null = null;

    const tryPosition = () => {
      if (positionedForCurrentOpenRef.current) return true;
      const positioned = positionLegend();
      if (positioned) {
        positionedForCurrentOpenRef.current = true;
        observer?.disconnect();
      }
      return positioned;
    };

    animationFrame = window.requestAnimationFrame(() => {
      if (tryPosition()) return;

      observer = new MutationObserver(() => {
        tryPosition();
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
      timeoutId = window.setTimeout(() => observer?.disconnect(), 2_500);
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeoutId);
      observer?.disconnect();
    };
  }, [legendVisible]);

  return null;
}
