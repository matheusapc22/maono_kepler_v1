import {
  POINT_CLUSTERING_VERSION,
  normalizePointClusterLayerPolicy,
  normalizePointClusteringExtension,
  type PointClusterLayerPolicy,
  type PointClusteringExtension,
} from "./point-cluster-policy.ts";
import type { PointClusterPair } from "./point-cluster-controller.ts";

type PointClusterStoreSnapshot = {
  extension: PointClusteringExtension;
  pairs: PointClusterPair[];
  hasPointClustering: boolean;
};

const listeners = new Set<() => void>();
let maonoPassthrough: Record<string, unknown> = {};
let snapshot: PointClusterStoreSnapshot = {
  extension: {
    version: POINT_CLUSTERING_VERSION,
    layers: {},
  },
  pairs: [],
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

export function loadPointClusterState(
  rawMaono: unknown,
  pairs: PointClusterPair[] = [],
) {
  const maono = isRecord(rawMaono) ? rawMaono : {};
  const {
    pointClustering: rawPointClustering,
    ...passthrough
  } = maono;

  maonoPassthrough = passthrough;
  snapshot = {
    extension: normalizePointClusteringExtension(
      rawPointClustering,
    ),
    pairs: [...pairs],
    hasPointClustering: isRecord(rawPointClustering),
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

export function registerPointClusterPair(pair: PointClusterPair) {
  const existing = snapshot.pairs.find(
    ({ pointLayerId }) =>
      pointLayerId === pair.pointLayerId,
  );

  if (
    existing?.clusterLayerId === pair.clusterLayerId
  ) {
    return;
  }

  snapshot = {
    ...snapshot,
    pairs: [
      ...snapshot.pairs.filter(
        ({ pointLayerId }) =>
          pointLayerId !== pair.pointLayerId,
      ),
      pair,
    ],
  };
  emit();
}

export function getPointClusterPolicyForClusterLayer(
  clusterLayerId: string,
) {
  const pair = snapshot.pairs.find(
    (candidate) =>
      candidate.clusterLayerId === clusterLayerId,
  );
  return pair
    ? snapshot.extension.layers[pair.pointLayerId] ?? null
    : null;
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
