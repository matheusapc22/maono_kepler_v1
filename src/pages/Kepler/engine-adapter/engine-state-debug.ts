import {
  collectionToArray,
  readValue,
  selectKeplerMapState,
} from "./selectors.ts";
import type { KeplerEngineState } from "./types.ts";

type DebugCapture = {
  capturedAt: string;
  raw: {
    mapAvailable: boolean;
    mapKeys: string[];
    visStateKeys: string[];
    uiStateKeys: string[];
    mapStateKeys: string[];
    layerIds: string[];
    layerTypes: string[];
    datasetIds: string[];
    filterTypes: string[];
  };
  snapshot: {
    mapId: string;
    mode: string;
    ready: boolean;
    layerIds: string[];
    datasetIds: string[];
    filterIds: string[];
    selectedLayerId: string | null;
    saveStatus: string;
    hasUnsavedChanges: boolean;
  };
};

type DebugApi = {
  capture(label?: string): DebugCapture;
};

declare global {
  interface Window {
    __MAONO_ENGINE_DEBUG__?: DebugApi;
  }
}

function recordKeys(value: unknown) {
  if (!value || typeof value !== "object") return [];
  if (typeof (value as { keySeq?: () => { toArray(): unknown[] } }).keySeq === "function") {
    return (value as { keySeq(): { toArray(): unknown[] } })
      .keySeq()
      .toArray()
      .map(String)
      .sort();
  }
  return Object.keys(value).sort();
}

function datasetEntries(value: unknown): Array<[string, unknown]> {
  if (!value || typeof value !== "object") return [];
  if (
    typeof (value as { entrySeq?: () => { toArray(): unknown[] } }).entrySeq ===
    "function"
  ) {
    return (value as { entrySeq(): { toArray(): unknown[] } })
      .entrySeq()
      .toArray() as Array<[string, unknown]>;
  }
  if (value instanceof Map) return Array.from(value.entries());
  return Object.entries(value);
}

export function summarizeKeplerEngineState(
  rootState: unknown,
  snapshot: KeplerEngineState,
): DebugCapture {
  const mapState = selectKeplerMapState(rootState);
  const visState = readValue(mapState, "visState");
  const layers = collectionToArray<unknown>(readValue(visState, "layers"));
  const datasets = datasetEntries(readValue(visState, "datasets"));
  const filters = collectionToArray<unknown>(readValue(visState, "filters"));

  return {
    capturedAt: new Date().toISOString(),
    raw: {
      mapAvailable: Boolean(mapState),
      mapKeys: recordKeys(mapState),
      visStateKeys: recordKeys(visState),
      uiStateKeys: recordKeys(readValue(mapState, "uiState")),
      mapStateKeys: recordKeys(readValue(mapState, "mapState")),
      layerIds: layers.map((layer) => String(readValue(layer, "id") ?? "")),
      layerTypes: layers.map((layer) => String(readValue(layer, "type") ?? "")),
      datasetIds: datasets.map(([key, dataset]) =>
        String(readValue(dataset, "id") ?? key),
      ),
      filterTypes: filters.map((filter) =>
        String(readValue(filter, "type") ?? "unknown"),
      ),
    },
    snapshot: {
      mapId: snapshot.mapId,
      mode: snapshot.mode,
      ready: snapshot.ready,
      layerIds: snapshot.layers.map((layer) => layer.id),
      datasetIds: snapshot.datasets.map((dataset) => dataset.id),
      filterIds: snapshot.filters.map((filter) => filter.id),
      selectedLayerId: snapshot.selectedLayerId,
      saveStatus: snapshot.save.status,
      hasUnsavedChanges: snapshot.save.hasUnsavedChanges,
    },
  };
}

function debugEnabled() {
  if (typeof window === "undefined") return false;
  return (
    new URLSearchParams(window.location.search).get("maonoEngineDebug") === "1" ||
    window.localStorage.getItem("maono:engine-debug") === "1"
  );
}

export function installKeplerEngineStateDebug(
  getRootState: () => unknown,
  getSnapshot: () => KeplerEngineState,
) {
  if (!debugEnabled()) return () => undefined;

  const api: DebugApi = {
    capture(label = "manual") {
      const capture = summarizeKeplerEngineState(
        getRootState(),
        getSnapshot(),
      );
      console.groupCollapsed(`[Maõno engine debug] ${label}`);
      console.table({
        mapId: capture.snapshot.mapId,
        mode: capture.snapshot.mode,
        ready: capture.snapshot.ready,
        layers: capture.snapshot.layerIds.length,
        datasets: capture.snapshot.datasetIds.length,
        filters: capture.snapshot.filterIds.length,
        saveStatus: capture.snapshot.saveStatus,
      });
      console.log(capture);
      console.groupEnd();
      return capture;
    },
  };

  window.__MAONO_ENGINE_DEBUG__ = api;
  api.capture("installed");

  return () => {
    if (window.__MAONO_ENGINE_DEBUG__ === api) {
      delete window.__MAONO_ENGINE_DEBUG__;
    }
  };
}
