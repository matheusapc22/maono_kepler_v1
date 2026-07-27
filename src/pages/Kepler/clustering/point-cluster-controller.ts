import {
  normalizePointClusteringExtension,
  pointClusterLayerId,
  resolvePointClusterMode,
  type PointClusterLayerPolicy,
  type PointClusterMode,
  type PointClusteringExtension,
} from "./point-cluster-policy.ts";
import { getPointClusterEligibility } from "./point-cluster-eligibility.ts";

export type PointClusterPair = {
  pointLayerId: string;
  clusterLayerId: string;
};

export type PointClusterVisibilityChange = {
  layerId: string;
  isVisible: boolean;
};

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function columnValue(column: any) {
  return typeof column === "string"
    ? column
    : typeof column?.value === "string"
      ? column.value
      : null;
}

function comparableColumns(layer: any) {
  const columns = layer?.config?.columns ?? layer?.columns ?? {};
  return {
    lat: columnValue(columns.lat ?? columns.latitude),
    lng: columnValue(
      columns.lng ??
      columns.lon ??
      columns.longitude ??
      null,
    ),
    geojson: columnValue(columns.geojson),
  };
}

function sameColumns(left: any, right: any) {
  const leftColumns = comparableColumns(left);
  const rightColumns = comparableColumns(right);

  if (leftColumns.geojson || rightColumns.geojson) {
    return (
      Boolean(leftColumns.geojson) &&
      leftColumns.geojson === rightColumns.geojson
    );
  }

  return (
    Boolean(leftColumns.lat) &&
    Boolean(leftColumns.lng) &&
    leftColumns.lat === rightColumns.lat &&
    leftColumns.lng === rightColumns.lng
  );
}

function findSavedDataset(savedConfig: any, dataId: unknown) {
  const resolvedDataId = Array.isArray(dataId)
    ? dataId[0]
    : dataId;
  const datasets = Array.isArray(savedConfig?.datasets)
    ? savedConfig.datasets
    : [];

  return datasets.find((dataset: any) => {
    const candidateIds = [
      dataset?.id,
      dataset?.info?.id,
      dataset?.data?.id,
      dataset?.data?.info?.id,
    ];
    return candidateIds.includes(resolvedDataId);
  });
}

export function findCompatibleClusterLayer(
  pointLayer: any,
  layers: any[],
) {
  const deterministicId = pointClusterLayerId(pointLayer.id);
  const deterministic = layers.find(
    (layer) =>
      layer?.id === deterministicId && layer?.type === "cluster",
  );

  if (deterministic) {
    return deterministic;
  }

  const compatible = layers.filter(
    (layer) =>
      layer?.type === "cluster" &&
      layer?.config?.dataId === pointLayer?.config?.dataId &&
      sameColumns(layer, pointLayer),
  );

  return compatible.length === 1 ? compatible[0] : null;
}

export function buildPointClusterLayerConfig({
  pointLayer,
  policy,
  clusterLayerId,
  isVisible,
  latitudeColumn,
  longitudeColumn,
  geoJsonColumn,
}: {
  pointLayer: any;
  policy: PointClusterLayerPolicy;
  clusterLayerId?: string;
  isVisible: boolean;
  latitudeColumn?: string | null;
  longitudeColumn?: string | null;
  geoJsonColumn?: string | null;
}) {
  const pointConfig = pointLayer?.config ?? {};
  const pointVisConfig = pointConfig.visConfig ?? {};
  const pointVisualChannels =
    pointLayer?.visualChannels ?? {};
  const id =
    clusterLayerId ?? pointClusterLayerId(pointLayer.id);

  return {
    id,
    type: "cluster",
    config: {
      dataId: pointConfig.dataId,
      label: `${pointConfig.label ?? "Pontos"} · agrupado`,
      ...(geoJsonColumn
        ? { columnMode: "geojson" }
        : {}),
      color: pointConfig.color ?? [32, 199, 181],
      highlightColor:
        pointConfig.highlightColor ?? [252, 242, 26, 255],
      columns: geoJsonColumn
        ? { geojson: geoJsonColumn }
        : {
            lat:
              latitudeColumn ??
              pointConfig.columns?.lat ??
              pointConfig.columns?.latitude ??
              null,
            lng:
              longitudeColumn ??
              pointConfig.columns?.lng ??
              pointConfig.columns?.lon ??
              pointConfig.columns?.longitude ??
              null,
          },
      isVisible,
      visConfig: {
        opacity:
          typeof pointVisConfig.opacity === "number"
            ? pointVisConfig.opacity
            : 0.8,
        clusterRadius: policy.clusterSize,
        colorRange:
          pointVisConfig.colorRange ?? {
            name: "Global Warming",
            type: "sequential",
            category: "Uber",
            colors: [
              "#5A1846",
              "#900C3F",
              "#C70039",
              "#E3611C",
              "#F1920E",
              "#FFC300",
            ],
          },
        radiusRange: [8, Math.max(40, policy.clusterSize)],
        colorAggregation: "average",
      },
      hidden: false,
      textLabel: [],
    },
    visualChannels: {
      colorField:
        pointVisualChannels.colorField ??
        pointConfig.colorField ??
        null,
      colorScale:
        pointVisualChannels.colorScale ??
        pointConfig.colorScale ??
        "quantize",
    },
  };
}

export function resolveVisibilityChanges({
  pointLayer,
  clusterLayer,
  zoom,
  previousMode,
  policy,
}: {
  pointLayer: any;
  clusterLayer: any;
  zoom: number;
  previousMode?: PointClusterMode;
  policy: PointClusterLayerPolicy;
}) {
  const nextMode = resolvePointClusterMode({
    zoom,
    previousMode,
    policy,
  });
  const changes: PointClusterVisibilityChange[] = [];
  const showCluster = policy.enabled && nextMode === "cluster";
  const showPoints = !showCluster;

  if (Boolean(clusterLayer?.config?.isVisible) !== showCluster) {
    changes.push({
      layerId: clusterLayer.id,
      isVisible: showCluster,
    });
  }

  if (Boolean(pointLayer?.config?.isVisible) !== showPoints) {
    changes.push({
      layerId: pointLayer.id,
      isVisible: showPoints,
    });
  }

  return {
    nextMode,
    changes,
  };
}

export function prepareSavedConfigForPointClustering(
  savedConfig: any,
  options: { featureEnabled?: boolean } = {},
) {
  const rawExtension =
    savedConfig?.maono?.pointClustering;
  const extension = normalizePointClusteringExtension(
    rawExtension,
  );
  const featureEnabled = options.featureEnabled !== false;
  const savedLayers =
    savedConfig?.config?.visState?.layers;

  if (
    !Array.isArray(savedLayers) ||
    Object.keys(extension.layers).length === 0
  ) {
    return {
      savedConfig,
      extension,
      pairs: [] as PointClusterPair[],
    };
  }

  const nextLayers = savedLayers.map((layer: any) => ({
    ...layer,
    config: isRecord(layer?.config)
      ? { ...layer.config }
      : layer?.config,
  }));
  const pairs: PointClusterPair[] = [];
  const initialZoom =
    Number(savedConfig?.config?.mapState?.zoom) || 0;

  if (!featureEnabled) {
    for (const pointLayerId of Object.keys(
      extension.layers,
    )) {
      const pointLayer = nextLayers.find(
        (layer: any) => layer?.id === pointLayerId,
      );
      if (!pointLayer) {
        continue;
      }

      const existingCluster = findCompatibleClusterLayer(
        pointLayer,
        nextLayers,
      );
      pointLayer.config = {
        ...pointLayer.config,
        isVisible: true,
      };

      if (existingCluster) {
        existingCluster.config = {
          ...existingCluster.config,
          isVisible: false,
        };
        pairs.push({
          pointLayerId,
          clusterLayerId: existingCluster.id,
        });
      }
    }

    return {
      savedConfig: {
        ...savedConfig,
        config: {
          ...savedConfig.config,
          visState: {
            ...savedConfig.config.visState,
            layers: nextLayers,
          },
        },
      },
      extension,
      pairs,
    };
  }

  for (const [pointLayerId, policy] of Object.entries(
    extension.layers,
  )) {
    const pointLayer = nextLayers.find(
      (layer: any) => layer?.id === pointLayerId,
    );

    if (!pointLayer || !["point", "geojson"].includes(pointLayer.type)) {
      continue;
    }

    const pointColumns = comparableColumns(pointLayer);
    const existingCluster = findCompatibleClusterLayer(
      pointLayer,
      nextLayers,
    );
    const eligibility = getPointClusterEligibility(
      pointLayer,
      findSavedDataset(
        savedConfig,
        pointLayer?.config?.dataId,
      ),
    );

    if (policy.enabled && !eligibility.eligible) {
      pointLayer.config = {
        ...pointLayer.config,
        isVisible: true,
      };
      if (existingCluster) {
        existingCluster.config = {
          ...existingCluster.config,
          isVisible: false,
        };
        pairs.push({
          pointLayerId,
          clusterLayerId: existingCluster.id,
        });
      }
      continue;
    }

    if (
      !existingCluster &&
      (!pointColumns.geojson &&
        (!pointColumns.lat || !pointColumns.lng))
    ) {
      continue;
    }
    const initialMode = resolvePointClusterMode({
      zoom: initialZoom,
      policy,
    });
    const clusterLayer =
      existingCluster ??
      buildPointClusterLayerConfig({
        pointLayer,
        policy,
        isVisible: policy.enabled && initialMode === "cluster",
        latitudeColumn: pointColumns.lat,
        longitudeColumn: pointColumns.lng,
        geoJsonColumn: pointColumns.geojson,
      });

    if (!existingCluster) {
      nextLayers.push(clusterLayer);
    } else {
      clusterLayer.config = {
        ...clusterLayer.config,
        isVisible:
          policy.enabled && initialMode === "cluster",
        visConfig: {
          ...clusterLayer.config?.visConfig,
          clusterRadius: policy.clusterSize,
        },
      };
    }

    pointLayer.config = {
      ...pointLayer.config,
      isVisible:
        !policy.enabled || initialMode === "points",
    };
    pairs.push({
      pointLayerId,
      clusterLayerId: clusterLayer.id,
    });
  }

  return {
    savedConfig: {
      ...savedConfig,
      config: {
        ...savedConfig.config,
        visState: {
          ...savedConfig.config.visState,
          layers: nextLayers,
        },
      },
    },
    extension,
    pairs,
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

export function resolveClusterClick({
  clicked,
  mapState,
  pairs,
  extension,
}: {
  clicked: any;
  mapState: any;
  pairs: PointClusterPair[];
  extension: PointClusteringExtension;
}) {
  const deckLayerId =
    clicked?.layer?.id ?? clicked?.sourceLayer?.id;
  if (typeof deckLayerId !== "string") {
    return null;
  }

  const pair = pairs.find(
    ({ clusterLayerId }) =>
      deckLayerId === clusterLayerId ||
      deckLayerId.startsWith(`${clusterLayerId}-`),
  );
  if (!pair) {
    return null;
  }

  const policy = extension.layers[pair.pointLayerId];
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
