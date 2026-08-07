import { useEffect, useRef } from "react";

import { calculateNativeLegendPlacement } from "./native-overlay-placement";
import "./maono-native-overlays.css";

const LEGEND_SELECTORS = [
  ".map-legend",
  ".map-legend-panel",
  "[class*='map-legend']",
  "[class*='MapLegend']",
  "[class*='mapLegend']",
];

const POPUP_SELECTORS = [
  ".map-popover",
  ".map-popover__inner",
  ".layer-hover-info",
  "[class*='map-popover']",
  "[class*='MapPopover']",
  "[class*='layer-hover-info']",
  "[class*='LayerHoverInfo']",
];

const ORIGINAL_STYLE_DATASET_KEY = "maonoNativeLegendOriginalStyle";
const LEGEND_TEXT = /legenda(?:\s+da\s+camada)?|layer\s+legend|\blegend\b/i;
const POPUP_ACTION_TEXT = /select\s+geometry|selecionar\s+geometria/i;

function isVisiblePanel(element: HTMLElement, minimumWidth = 120) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return (
    rect.width >= minimumWidth &&
    rect.height >= 40 &&
    rect.width <= 640 &&
    rect.height <= 820 &&
    style.display !== "none" &&
    style.visibility !== "hidden"
  );
}

function normalizedText(element: HTMLElement) {
  return String(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function visibleLegendCandidates() {
  const unique = new Set<HTMLElement>();

  for (const selector of LEGEND_SELECTORS) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (isVisiblePanel(element)) unique.add(element);
    });
  }

  document
    .querySelectorAll<HTMLElement>("aside, section, div")
    .forEach((element) => {
      if (!isVisiblePanel(element, 140)) return;
      if (!LEGEND_TEXT.test(normalizedText(element))) return;
      unique.add(element);
    });

  return [...unique];
}

function findNativeLegend() {
  const candidates = visibleLegendCandidates().filter((element) =>
    LEGEND_TEXT.test(normalizedText(element)),
  );

  if (!candidates.length) {
    return visibleLegendCandidates()[0] || null;
  }

  return candidates.sort((left, right) => {
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    return leftRect.width * leftRect.height - rightRect.width * rightRect.height;
  })[0];
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

function popupLooksNative(element: HTMLElement) {
  if (!isVisiblePanel(element, 100)) return false;
  if (element.closest(".maono-map-overlay, .maono-tooltip-editor")) return false;

  const text = normalizedText(element);
  if (POPUP_ACTION_TEXT.test(text)) return true;
  if (
    element.querySelector(
      ".row__name, .row__value, [class*='row__name'], [class*='row__value']",
    )
  ) {
    return true;
  }

  return POPUP_SELECTORS.some((selector) => element.matches(selector));
}

function markPopupElement(element: HTMLElement) {
  if (!popupLooksNative(element)) return false;

  element.dataset.maonoNativePopup = "true";
  return true;
}

function markPopupsWithin(root: ParentNode | HTMLElement) {
  if (root instanceof HTMLElement) {
    markPopupElement(root);
  }

  for (const selector of POPUP_SELECTORS) {
    root.querySelectorAll?.<HTMLElement>(selector).forEach(markPopupElement);
  }

  root.querySelectorAll?.<HTMLElement>("div, section, aside").forEach((element) => {
    const text = normalizedText(element);
    if (POPUP_ACTION_TEXT.test(text)) markPopupElement(element);
  });
}

function restorePopupRuntime() {
  document
    .querySelectorAll<HTMLElement>("[data-maono-native-popup]")
    .forEach((popup) => {
      delete popup.dataset.maonoNativePopup;
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
    markPopupsWithin(document);

    const popupObserver = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) markPopupsWithin(node);
        });
      });
    });
    popupObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      popupObserver.disconnect();
      if (document.body.dataset.maonoNativeOverlays === "active") {
        delete document.body.dataset.maonoNativeOverlays;
      }
      restoreLegendRuntime();
      restorePopupRuntime();
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
      timeoutId = window.setTimeout(() => observer?.disconnect(), 3_500);
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeoutId);
      observer?.disconnect();
    };
  }, [legendVisible]);

  return null;
}
