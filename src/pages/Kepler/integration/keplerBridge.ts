export const KEPLER_MAP_ID = "map";

function asArray<T = any>(value: unknown): T[] {
  if (Array.isArray(value)) return value;

  if (
    value &&
    typeof value === "object" &&
    typeof (value as any).toArray === "function"
  ) {
    return (value as any).toArray();
  }

  return [];
}

function asObject<T extends Record<string, any>>(
  value: unknown,
  fallback: T,
): T {
  if (!value || typeof value !== "object") return fallback;

  if (typeof (value as any).toJS === "function") {
    return (value as any).toJS();
  }

  return value as T;
}

export function selectKeplerMapState(rootState: any) {
  return (
    rootState?.demo?.keplerGl?.[KEPLER_MAP_ID] ??
    rootState?.keplerGl?.[KEPLER_MAP_ID] ??
    null
  );
}

export function selectKeplerVisState(rootState: any) {
  return selectKeplerMapState(rootState)?.visState ?? null;
}

export function selectKeplerUiState(rootState: any) {
  return selectKeplerMapState(rootState)?.uiState ?? null;
}

export function selectKeplerViewportState(rootState: any) {
  return selectKeplerMapState(rootState)?.mapState ?? null;
}

export type MaonoLayerSnapshot = {
  id: string;
  type: string;
  label: string;
  isVisible: boolean;
  color: [number, number, number];
  opacity: number;
  dataId: string | string[] | null;
  raw: any;
};

export type MaonoFilterSnapshot = {
  id: string;
  index: number;
  dataId: string | string[] | null;
  name: string | string[] | null;
  type: string;
  value: any;
  enabled: boolean;
  raw: any;
};

export type MaonoDatasetSnapshot = {
  id: string;
  label: string;
  raw: any;
};

function normalizedColor(value: unknown): [number, number, number] {
  const color = asArray<number>(value);
  return [
    Number(color[0] ?? 47),
    Number(color[1] ?? 125),
    Number(color[2] ?? 244),
  ];
}

export function normalizeKeplerLayers(
  value: unknown,
): MaonoLayerSnapshot[] {
  return asArray<any>(value)
    .filter((layer) => layer?.id)
    .map((layer) => {
      const config = asObject(layer.config, {} as any);
      const visConfig = asObject(config.visConfig, {} as any);

      return {
        id: String(layer.id),
        type: String(layer.type || "layer"),
        label: String(config.label || layer.id),
        isVisible: config.isVisible !== false,
        color: normalizedColor(config.color),
        opacity: Number.isFinite(Number(visConfig.opacity))
          ? Number(visConfig.opacity)
          : 0.8,
        dataId: config.dataId ?? layer.dataId ?? null,
        raw: layer,
      };
    });
}

export function normalizeKeplerFilters(
  value: unknown,
): MaonoFilterSnapshot[] {
  return asArray<any>(value).map((filter, index) => {
    const normalized = asObject(filter, {} as any);

    return {
      id: String(normalized.id || `filter-${index}`),
      index,
      dataId: normalized.dataId ?? null,
      name: normalized.name ?? null,
      type: String(normalized.type || "range"),
      value: normalized.value,
      enabled: normalized.enabled !== false,
      raw: filter,
    };
  });
}

export function normalizeKeplerDatasets(
  value: unknown,
): MaonoDatasetSnapshot[] {
  if (!value || typeof value !== "object") return [];

  const entries =
    typeof (value as any).entrySeq === "function"
      ? (value as any).entrySeq().toArray()
      : value instanceof Map
        ? Array.from(value.entries())
      : Object.entries(value as Record<string, any>);

  return entries.map(([id, dataset]: [string, any]) => ({
    id: String(dataset?.id ?? id),
    label: String(dataset?.label ?? dataset?.info?.label ?? id),
    raw: dataset,
  }));
}
