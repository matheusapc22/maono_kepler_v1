import { KeplerGlSchema } from "@kepler.gl/schemas";

function fallbackDatasets(mapState: any) {
  return Object.entries(mapState?.visState?.datasets || {}).map(([id, value]) => {
    const dataset = value as any;
    return { version: "v1", data: dataset?.data || dataset, info: { id, label: dataset?.label || id } };
  });
}

export function normalizeSavedKeplerConfig(rawSaved: any, mapState: any) {
  const saved = rawSaved && typeof rawSaved === "object" ? rawSaved : {};
  return {
    ...saved,
    version: saved.version || "v1",
    datasets: Array.isArray(saved.datasets) ? saved.datasets : fallbackDatasets(mapState),
    config: saved.config && typeof saved.config === "object" ? saved.config : {
      visState: saved.visState || mapState?.visState || {},
      mapState: saved.mapState || mapState?.mapState || {},
      mapStyle: saved.mapStyle || mapState?.mapStyle || {},
    },
  };
}

export function serializeProjectConfig(mapState: any) {
  return normalizeSavedKeplerConfig(KeplerGlSchema.save(mapState), mapState);
}

export type ThumbnailSnapshot = {
  savedConfig: any;
  camera: Record<string, number>;
  layers: any[];
  datasets: { id: string; dataset: any }[];
};

/** Saved serialized datasets are owned by the save snapshot. We retain those
 * immutable references, rather than copy all GeoJSON for a 960x540 preview.
 * Small camera/layer/filter metadata is copied once and never read live again. */
export function prepareThumbnailSnapshot(_mapState: any, savedConfig: any): ThumbnailSnapshot {
  // Capture may inspect only the serialized snapshot. The serializer's legacy
  // runtime fallback is not authority to invent missing saved camera/data here.
  const saved = normalizeSavedKeplerConfig(savedConfig, {});
  // KeplerGlSchema.save emits {config: {version, config: {mapState, ...}}}.
  // Keep that persisted envelope unchanged; unwrap only the capture's owned
  // metadata view, never substitute a live camera for a missing saved camera.
  const savedContents = saved.config?.version && saved.config?.config && typeof saved.config.config === "object"
    ? saved.config.config : saved.config;
  const config = structuredClone({ ...savedContents, visState: {
    layers: savedContents.visState?.layers || [],
    filters: savedContents.visState?.filters || [],
  } });
  const byId = new Map<string, any>();
  for (const [index, layer] of config.visState.layers.entries()) {
    const id = String(layer.id || `anonymous-${index}`);
    if (!byId.has(id)) byId.set(id, layer);
  }
  const layers = [...byId.values()].filter((layer) => layer.config?.isVisible !== false && layer.isVisible !== false);
  config.visState.layers = layers;
  const datasetsById = new Map<string, any>();
  for (const [index, dataset] of saved.datasets.entries()) {
    const id = String(dataset?.data?.id || dataset?.info?.id || dataset?.id || `saved-${index}`);
    if (!datasetsById.has(id)) datasetsById.set(id, dataset);
  }
  const camera: Record<string, number> = {};
  for (const key of ["longitude", "latitude", "zoom", "pitch", "bearing"]) {
    camera[key] = Number(config.mapState?.[key] ?? (["pitch", "bearing"].includes(key) ? 0 : NaN));
  }
  if (Object.values(camera).some((value) => !Number.isFinite(value))) throw new Error("CAPTURE_INVALID_CAMERA");
  return { savedConfig: { ...saved, config }, camera, layers, datasets: [...datasetsById].map(([id, dataset]) => ({ id, dataset })) };
}
