import {
  normalizePointClusterLayerPolicy,
  normalizePointClusteringExtension,
  type PointClusteringExtension,
} from "./point-cluster-policy.ts";

export const LEGACY_CLUSTER_LAYER_PREFIX = "maono-cluster-";
export const ADAPTIVE_CLUSTER_DECK_SUFFIX = "-maono-cluster-runtime";

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function layerId(layer: any) {
  return String(layer?.id ?? "").trim();
}

function layerType(layer: any) {
  return String(layer?.type ?? "").trim().toLocaleLowerCase();
}

function layerConfig(layer: any) {
  return isRecord(layer?.config) ? layer.config : {};
}

function cloneLayer(layer: any) {
  return {
    ...layer,
    config: {
      ...layerConfig(layer),
      visConfig: isRecord(layerConfig(layer).visConfig)
        ? { ...layerConfig(layer).visConfig }
        : layerConfig(layer).visConfig,
    },
  };
}

function isLogicalPointLayer(layer: any) {
  const type = layerType(layer);
  return type === "point" || type === "geojson";
}

export function legacyPointClusterLayerId(pointLayerId: string) {
  return `${LEGACY_CLUSTER_LAYER_PREFIX}${pointLayerId}`;
}

export function adaptiveClusterDeckLayerId(pointLayerId: string) {
  return `${pointLayerId}${ADAPTIVE_CLUSTER_DECK_SUFFIX}`;
}

function originalLayerIdFromLegacyCluster(layer: any) {
  const id = layerId(layer);
  return id.startsWith(LEGACY_CLUSTER_LAYER_PREFIX)
    ? id.slice(LEGACY_CLUSTER_LAYER_PREFIX.length)
    : null;
}

function isVisible(layer: any) {
  return layerConfig(layer).isVisible !== false;
}

function legacyPolicyFromCluster(existingPolicy: unknown, clusterLayer: any) {
  const clusterRadius = Number(
    layerConfig(clusterLayer)?.visConfig?.clusterRadius,
  );

  return normalizePointClusterLayerPolicy({
    ...(isRecord(existingPolicy) ? existingPolicy : {}),
    enabled:
      isRecord(existingPolicy) && typeof existingPolicy.enabled === "boolean"
        ? existingPolicy.enabled
        : true,
    ...(Number.isFinite(clusterRadius)
      ? { clusterSize: clusterRadius }
      : {}),
  });
}

function normalizedMaonoConfig(
  rawMaono: unknown,
  extension: PointClusteringExtension,
  includePointClustering: boolean,
) {
  const maono = isRecord(rawMaono) ? rawMaono : {};
  const { pointClustering: _legacyPointClustering, ...passthrough } = maono;

  return includePointClustering
    ? { ...passthrough, pointClustering: extension }
    : passthrough;
}

export function prepareSavedConfigForPointClustering(
  savedConfig: any,
  options: { featureEnabled?: boolean } = {},
) {
  void options.featureEnabled;

  const rawMaono = savedConfig?.maono;
  const rawExtension = isRecord(rawMaono)
    ? rawMaono.pointClustering
    : undefined;
  const normalizedExtension = normalizePointClusteringExtension(
    rawExtension,
  );
  const savedLayers = savedConfig?.config?.visState?.layers;

  if (!Array.isArray(savedLayers)) {
    return {
      savedConfig,
      extension: normalizedExtension,
      migration: {
        migrated: false,
        migratedLayerIds: [] as string[],
        removedClusterLayerIds: [] as string[],
      },
    };
  }

  const clonedLayers = savedLayers.map(cloneLayer);
  const logicalLayersById = new Map(
    clonedLayers
      .filter(isLogicalPointLayer)
      .map((layer: any) => [layerId(layer), layer]),
  );
  const derivedClustersByPointId = new Map<string, any>();
  const removedClusterLayerIds: string[] = [];

  for (const layer of clonedLayers) {
    const pointLayerId = originalLayerIdFromLegacyCluster(layer);
    if (!pointLayerId) continue;

    derivedClustersByPointId.set(pointLayerId, layer);
    removedClusterLayerIds.push(layerId(layer));
  }

  const nextPolicies = {
    ...normalizedExtension.layers,
  };
  const migratedLayerIds: string[] = [];

  for (const [pointLayerId, clusterLayer] of derivedClustersByPointId) {
    const pointLayer = logicalLayersById.get(pointLayerId);
    if (!pointLayer) {
      delete nextPolicies[pointLayerId];
      continue;
    }

    const logicalVisible = isVisible(pointLayer) || isVisible(clusterLayer);
    pointLayer.config = {
      ...layerConfig(pointLayer),
      isVisible: logicalVisible,
    };
    nextPolicies[pointLayerId] = legacyPolicyFromCluster(
      nextPolicies[pointLayerId],
      clusterLayer,
    );
    migratedLayerIds.push(pointLayerId);
  }

  for (const pointLayerId of Object.keys(nextPolicies)) {
    if (!logicalLayersById.has(pointLayerId)) {
      delete nextPolicies[pointLayerId];
    }
  }

  const nextLayers = clonedLayers.filter(
    (layer: any) => !originalLayerIdFromLegacyCluster(layer),
  );
  const removedIds = new Set(removedClusterLayerIds);
  const layerOrder = savedConfig?.config?.visState?.layerOrder;
  const nextLayerOrder = Array.isArray(layerOrder)
    ? layerOrder.filter((id: unknown) => !removedIds.has(String(id)))
    : layerOrder;
  const extension: PointClusteringExtension = {
    ...normalizedExtension,
    layers: nextPolicies,
  };
  const includePointClustering =
    isRecord(rawExtension) ||
    Object.keys(extension.layers).length > 0;
  const nextMaono = normalizedMaonoConfig(
    rawMaono,
    extension,
    includePointClustering,
  );
  const migrated = removedClusterLayerIds.length > 0;

  const { maono: _rawMaono, ...savedConfigWithoutMaono } = savedConfig;

  return {
    savedConfig: {
      ...savedConfigWithoutMaono,
      ...(Object.keys(nextMaono).length > 0
        ? { maono: nextMaono }
        : {}),
      config: {
        ...savedConfig.config,
        visState: {
          ...savedConfig.config.visState,
          layers: nextLayers,
          ...(Array.isArray(layerOrder)
            ? { layerOrder: nextLayerOrder }
            : {}),
        },
      },
    },
    extension,
    migration: {
      migrated,
      migratedLayerIds,
      removedClusterLayerIds,
    },
  };
}

export function getClusterPointCount(clickedObject: any) {
  if (Array.isArray(clickedObject?.filteredPoints)) {
    return clickedObject.filteredPoints.length;
  }
  if (Array.isArray(clickedObject?.points)) {
    return clickedObject.points.length;
  }
  const pointCount = Number(
    clickedObject?.pointCount ??
      clickedObject?.properties?.point_count,
  );
  return Number.isFinite(pointCount) ? pointCount : 0;
}

function runtimePointLayerId(
  deckLayerId: unknown,
  extension: PointClusteringExtension,
) {
  if (typeof deckLayerId !== "string") {
    return null;
  }

  const layerIds = Object.keys(extension.layers).sort(
    (left, right) => right.length - left.length,
  );

  return (
    layerIds.find((pointLayerId) => {
      const runtimeId = adaptiveClusterDeckLayerId(pointLayerId);
      return (
        deckLayerId === runtimeId ||
        deckLayerId.startsWith(`${runtimeId}-`)
      );
    }) ?? null
  );
}

export function resolveClusterClick({
  clicked,
  mapState,
  extension,
}: {
  clicked: any;
  mapState: any;
  extension: PointClusteringExtension;
}) {
  const deckLayerId =
    clicked?.layer?.id ?? clicked?.sourceLayer?.id;
  const pointLayerId = runtimePointLayerId(
    deckLayerId,
    extension,
  );
  if (!pointLayerId) {
    return null;
  }

  const policy = extension.layers[pointLayerId];
  const position =
    clicked?.object?.position ?? clicked?.coordinate;
  const pointCount = getClusterPointCount(clicked?.object);

  if (
    !policy?.enabled ||
    pointCount <= 1 ||
    !Array.isArray(position) ||
    !Number.isFinite(Number(position[0])) ||
    !Number.isFinite(Number(position[1]))
  ) {
    return null;
  }

  return {
    longitude: Number(position[0]),
    latitude: Number(position[1]),
    zoom: Math.min(24, Number(mapState?.zoom ?? 0) + 2),
    transitionDuration: 350,
  };
}
