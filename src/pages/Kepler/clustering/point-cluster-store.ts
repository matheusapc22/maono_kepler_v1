import {
  POINT_CLUSTERING_VERSION,
  normalizePointClusterLayerPolicy,
  normalizePointClusteringExtension,
  type PointClusterLayerPolicy,
  type PointClusteringExtension,
} from "./point-cluster-policy.ts";

type PointClusterStoreSnapshot = {
  extension: PointClusteringExtension;
  hasPointClustering: boolean;
};

const listeners = new Set<() => void>();
let maonoPassthrough: Record<string, unknown> = {};
let snapshot: PointClusterStoreSnapshot = {
  extension: {
    version: POINT_CLUSTERING_VERSION,
    layers: {},
  },
  hasPointClustering: false,
};

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function subscribePointClusterStore(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPointClusterSnapshot() {
  return snapshot;
}

export function loadPointClusterState(rawMaono: unknown) {
  const maono = isRecord(rawMaono) ? rawMaono : {};
  const {
    pointClustering: rawPointClustering,
    ...passthrough
  } = maono;
  const extension = normalizePointClusteringExtension(
    rawPointClustering,
  );

  maonoPassthrough = passthrough;
  snapshot = {
    extension,
    hasPointClustering:
      Object.keys(extension.layers).length > 0,
  };
  emit();
}

export function updatePointClusterLayerPolicy(
  pointLayerId: string,
  update:
    | Partial<PointClusterLayerPolicy>
    | ((
        previous: PointClusterLayerPolicy,
      ) => Partial<PointClusterLayerPolicy>),
  pointCount?: number,
) {
  const previous = normalizePointClusterLayerPolicy(
    snapshot.extension.layers[pointLayerId],
    pointCount,
  );
  const patch =
    typeof update === "function" ? update(previous) : update;
  const nextPolicy = normalizePointClusterLayerPolicy(
    { ...previous, ...patch },
    pointCount,
  );

  snapshot = {
    ...snapshot,
    hasPointClustering: true,
    extension: {
      version: POINT_CLUSTERING_VERSION,
      layers: {
        ...snapshot.extension.layers,
        [pointLayerId]: nextPolicy,
      },
    },
  };
  emit();
}

export function prunePointClusterLayerPolicies(
  validPointLayerIds: Iterable<string>,
) {
  const valid = new Set(
    Array.from(validPointLayerIds, (value) =>
      String(value).trim(),
    ).filter(Boolean),
  );
  const entries = Object.entries(snapshot.extension.layers);
  const nextEntries = entries.filter(([layerId]) => valid.has(layerId));

  if (nextEntries.length === entries.length) {
    return false;
  }

  snapshot = {
    ...snapshot,
    hasPointClustering: nextEntries.length > 0,
    extension: {
      version: POINT_CLUSTERING_VERSION,
      layers: Object.fromEntries(nextEntries),
    },
  };
  emit();
  return true;
}

export function getPointClusterPolicy(pointLayerId: string) {
  return snapshot.extension.layers[pointLayerId] ?? null;
}

export function getMaonoConfigForSave() {
  const hasLayers =
    Object.keys(snapshot.extension.layers).length > 0;

  if (
    !snapshot.hasPointClustering &&
    !hasLayers &&
    Object.keys(maonoPassthrough).length === 0
  ) {
    return undefined;
  }

  return {
    ...maonoPassthrough,
    ...(snapshot.hasPointClustering || hasLayers
      ? { pointClustering: snapshot.extension }
      : {}),
  };
}
