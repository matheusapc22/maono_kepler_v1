export type MaonoMapPanelTab = "layers" | "filters";

export const MAONO_MAP_PANEL_TAB_REQUEST_EVENT =
  "maono:map-panel-tab-request";
export const MAONO_MAP_PANEL_TAB_CHANGED_EVENT =
  "maono:map-panel-tab-changed";

function isMapPanelTab(value: unknown): value is MaonoMapPanelTab {
  return value === "layers" || value === "filters";
}

function dispatchMapPanelEvent(
  eventName: string,
  tab: MaonoMapPanelTab,
) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(eventName, {
      detail: { tab },
    }),
  );
}

export function requestMaonoMapPanelTab(tab: MaonoMapPanelTab) {
  dispatchMapPanelEvent(MAONO_MAP_PANEL_TAB_REQUEST_EVENT, tab);
}

export function notifyMaonoMapPanelTabChanged(tab: MaonoMapPanelTab) {
  dispatchMapPanelEvent(MAONO_MAP_PANEL_TAB_CHANGED_EVENT, tab);
}

export function mapPanelTabFromEvent(event: Event) {
  if (!(event instanceof CustomEvent)) {
    return null;
  }

  const tab = event.detail?.tab;
  return isMapPanelTab(tab) ? tab : null;
}
