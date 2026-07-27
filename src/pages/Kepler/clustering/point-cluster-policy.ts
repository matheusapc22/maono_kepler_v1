export const POINT_CLUSTERING_VERSION = 1 as const;
export const DEFAULT_CLUSTER_MAX_ZOOM = 12;
export const DEFAULT_CLUSTER_HYSTERESIS = 0.25;
export const DEFAULT_CLUSTER_SIZE = 50;
export const DEFAULT_SHOW_COUNT = true;
export const DEFAULT_MINIMUM_POINT_COUNT = 250;
export const MAX_CLIENT_POINT_COUNT = 300_000;

export type PointClusterMode = "cluster" | "points";
export type PointClusterDeliveryClass =
  | "safe"
  | "warn"
  | "tile_required";

export type PointClusterLayerPolicy = {
  enabled: boolean;
  clusterMaxZoom: number;
  hysteresis: number;
  clusterSize: number;
  showCount: boolean;
};

export type PointClusteringExtension = {
  version: typeof POINT_CLUSTERING_VERSION;
  layers: Record<string, PointClusterLayerPolicy>;
};

export type AdaptivePointClusterDefaults = Pick<
  PointClusterLayerPolicy,
  "clusterMaxZoom" | "clusterSize"
> & {
  delivery: PointClusterDeliveryClass;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function finiteNumber(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function getAdaptivePointClusterDefaults(
  pointCount: number,
): AdaptivePointClusterDefaults {
  const normalizedCount = Math.max(0, finiteNumber(pointCount, 0));

  if (normalizedCount > MAX_CLIENT_POINT_COUNT) {
    return {
      clusterMaxZoom: 13,
      clusterSize: 70,
      delivery: "tile_required",
    };
  }

  if (normalizedCount > 100_000) {
    return {
      clusterMaxZoom: 13,
      clusterSize: 70,
      delivery: "warn",
    };
  }

  if (normalizedCount > 10_000) {
    return {
      clusterMaxZoom: 12,
      clusterSize: 55,
      delivery: "warn",
    };
  }

  return {
    clusterMaxZoom: 11,
    clusterSize: 40,
    delivery: "safe",
  };
}

export function normalizePointClusterLayerPolicy(
  value: unknown,
  pointCount?: number,
): PointClusterLayerPolicy {
  const source = isRecord(value) ? value : {};
  const adaptive =
    typeof pointCount === "number"
      ? getAdaptivePointClusterDefaults(pointCount)
      : {
          clusterMaxZoom: DEFAULT_CLUSTER_MAX_ZOOM,
          clusterSize: DEFAULT_CLUSTER_SIZE,
        };

  return {
    enabled: source.enabled === true,
    clusterMaxZoom: clamp(
      finiteNumber(source.clusterMaxZoom, adaptive.clusterMaxZoom),
      0,
      24,
    ),
    hysteresis: clamp(
      finiteNumber(source.hysteresis, DEFAULT_CLUSTER_HYSTERESIS),
      0,
      2,
    ),
    clusterSize: clamp(
      finiteNumber(source.clusterSize, adaptive.clusterSize),
      1,
      500,
    ),
    showCount:
      typeof source.showCount === "boolean"
        ? source.showCount
        : DEFAULT_SHOW_COUNT,
  };
}

export function normalizePointClusteringExtension(
  value: unknown,
): PointClusteringExtension {
  if (!isRecord(value) || value.version !== POINT_CLUSTERING_VERSION) {
    return {
      version: POINT_CLUSTERING_VERSION,
      layers: {},
    };
  }

  const sourceLayers = isRecord(value.layers) ? value.layers : {};
  const layers = Object.entries(sourceLayers).reduce<
    Record<string, PointClusterLayerPolicy>
  >((normalized, [layerId, layerPolicy]) => {
    const stableId = layerId.trim();
    if (!stableId) {
      return normalized;
    }

    normalized[stableId] =
      normalizePointClusterLayerPolicy(layerPolicy);
    return normalized;
  }, {});

  return {
    version: POINT_CLUSTERING_VERSION,
    layers,
  };
}

export function resolvePointClusterMode({
  zoom,
  previousMode,
  policy,
}: {
  zoom: number;
  previousMode?: PointClusterMode;
  policy: PointClusterLayerPolicy;
}): PointClusterMode {
  if (!policy.enabled) {
    return "points";
  }

  const normalizedZoom = finiteNumber(zoom, policy.clusterMaxZoom);
  const lowerBoundary = policy.clusterMaxZoom - policy.hysteresis;
  const upperBoundary = policy.clusterMaxZoom + policy.hysteresis;

  if (previousMode === "cluster") {
    return normalizedZoom > upperBoundary ? "points" : "cluster";
  }

  if (previousMode === "points") {
    return normalizedZoom < lowerBoundary ? "cluster" : "points";
  }

  return normalizedZoom <= policy.clusterMaxZoom
    ? "cluster"
    : "points";
}

export function pointClusterLayerId(pointLayerId: string) {
  return `maono-cluster-${pointLayerId}`;
}

export function isPointClusteringFeatureEnabled(
  environmentValue: unknown,
) {
  return environmentValue !== "false";
}
