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
const LEGEND_TITLE_TEXT = /^(?:legenda(?:\s+da\s+camada)?|layer\s+legend|legend)$/i;
const LEGEND_TEXT = /legenda(?:\s+da\s+camada)?|layer\s+legend|\blegend\b/i;
const POPUP_ACTION_TEXT = /select\s+geometry|selecionar\s+geometria/i;

function normalizedText(element: HTMLElement) {
  return String(element.textContent || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isVisibleElement(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden"
  );
}

function isLegendPanelGeometry(element: HTMLElement, minimumHeight = 96) {
  if (!isVisibleElement(element)) return false;
  const rect = element.getBoundingClientRect();
  return (
    rect.width >= 140 &&
    rect.width <= 640 &&
    rect.height >= minimumHeight &&
    rect.height <= 820
  );
}

function findLegendTitle() {
  const candidates = document.querySelectorAll<HTMLElement>(
    "div, span, strong, h1, h2, h3, header",
  );

  for (const element of candidates) {
    if (!isVisibleElement(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.height > 96 || rect.width > 520) continue;
    if (LEGEND_TITLE_TEXT.test(normalizedText(element))) {
      return element;
    }
  }

  return null;
}

function panelFromLegendTitle(title: HTMLElement) {
  const titleRect = title.getBoundingClientRect();
  const candidates: HTMLElement[] = [];
  let current = title.parentElement;

  for (let depth = 0; current && depth < 9; depth += 1) {
    const rect = current.getBoundingClientRect();
    if (
      isLegendPanelGeometry(current, Math.max(110, titleRect.height * 2)) &&
      rect.width >= titleRect.width &&
      LEGEND_TEXT.test(normalizedText(current))
    ) {
      candidates.push(current);
    }
    current = current.parentElement;
  }

  if (!candidates.length) return null;

  return candidates.sort((left, right) => {
    const a = left.getBoundingClientRect();
    const b = right.getBoundingClientRect();
    return a.width * a.height - b.width * b.height;
  })[0];
}

function visibleLegendCandidates() {
  const unique = new Set<HTMLElement>();

  for (const selector of LEGEND_SELECTORS) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      if (
        isLegendPanelGeometry(element) &&
        LEGEND_TEXT.test(normalizedText(element))
      ) {
        unique.add(element);
      }
    });
  }

  document
    .querySelectorAll<HTMLElement>("aside, section, div")
    .forEach((element) => {
      if (!isLegendPanelGeometry(element, 110)) return;
      if (!LEGEND_TEXT.test(normalizedText(element))) return;
      unique.add(element);
    });

  return [...unique];
}

function findNativeLegend() {
  const title = findLegendTitle();
  const titledPanel = title ? panelFromLegendTitle(title) : null;
  if (titledPanel) return titledPanel;

  const candidates = visibleLegendCandidates();
  if (!candidates.length) return null;

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
      const rect = current.getBoundingClientRect();
      if (rect.width <= 700 && rect.height <= 860) return current;
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
  if (!isVisibleElement(element)) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 100 || rect.height < 40 || rect.width > 720 || rect.height > 860) {
    return false;
  }
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
    if (POPUP_ACTION_TEXT.test(normalizedText(element))) {
      markPopupElement(element);
    }
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
      timeoutId = window.setTimeout(() => observer?.disconnect(), 5_000);
    });

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeoutId);
      observer?.disconnect();
    };
  }, [legendVisible]);

  return null;
}
