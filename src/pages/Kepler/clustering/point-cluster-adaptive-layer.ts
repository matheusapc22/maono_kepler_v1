// @ts-nocheck

import { TextLayer } from "@deck.gl/layers";
import { DeckGLClusterLayer } from "@kepler.gl/deckgl-layers";
import { LayerClasses } from "@kepler.gl/layers";

import {
  adaptiveClusterDeckLayerId,
} from "./point-cluster-controller.ts";
import {
  buildNativePointClusterFilter,
  NATIVE_CLUSTER_RADIUS_RANGE,
} from "./point-cluster-native-data-adapter.ts";
import {
  MAX_CLIENT_POINT_COUNT,
  isPointClusteringFeatureEnabled,
  resolvePointClusterMode,
} from "./point-cluster-policy.ts";
import {
  getPointClusterPolicy,
} from "./point-cluster-store.ts";

const POINT_CLUSTERING_FEATURE_ENABLED =
  isPointClusteringFeatureEnabled(
    import.meta.env.VITE_POINT_CLUSTERING_V1,
  );

function visiblePointCount(cell) {
  return Array.isArray(cell?.filteredPoints)
    ? cell.filteredPoints.length
    : Array.isArray(cell?.points)
      ? cell.points.length
      : Number(cell?.pointCount ?? 0);
}

function hexToRgb(value) {
  const normalized = String(value ?? "").trim();
  const match = /^#([0-9a-f]{6})$/i.exec(normalized);
  if (!match) return null;
  const numeric = Number.parseInt(match[1], 16);
  return [
    (numeric >> 16) & 255,
    (numeric >> 8) & 255,
    numeric & 255,
  ];
}

function normalizedRgb(value, fallback = [197, 160, 89]) {
  if (!Array.isArray(value) || value.length < 3) {
    return fallback;
  }

  const channels = value.slice(0, 3).map(Number);
  return channels.every(Number.isFinite)
    ? channels.map((channel) =>
        Math.max(0, Math.min(255, Math.round(channel))),
      )
    : fallback;
}

function clusterColorRange(layer) {
  const configured = layer?.config?.visConfig?.colorRange?.colors;
  const colors = Array.isArray(configured)
    ? configured.map(hexToRgb).filter(Boolean)
    : [];

  if (colors.length >= 2) {
    return colors;
  }

  const base = normalizedRgb(layer?.config?.color);
  const dark = base.map((channel) => Math.round(channel * 0.55));
  const light = base.map((channel) =>
    Math.round(channel + (255 - channel) * 0.7),
  );
  return [dark, base, light];
}

function clusterPoints(object) {
  if (Array.isArray(object?.filteredPoints)) {
    return object.filteredPoints;
  }
  if (Array.isArray(object?.points)) {
    return object.points;
  }
  return null;
}

function sourcePointIndex(point) {
  const index = Number(
    point?.index ??
      point?.source?.index ??
      point?.properties?.index,
  );
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function clusterHoverData(object, dataContainer) {
  const points = clusterPoints(object);
  const index = points?.length
    ? sourcePointIndex(points[0])
    : null;

  if (index === null) {
    return null;
  }

  return dataContainer.row(index);
}

function featureGeometry(feature) {
  return feature?.type === "Feature"
    ? feature.geometry
    : feature?.geometry ?? feature;
}

function pointFeatureData(value) {
  if (!Array.isArray(value)) {
    return null;
  }

  const features = value.filter(Boolean);
  if (features.length > MAX_CLIENT_POINT_COUNT) {
    return null;
  }

  const allPoints = features.every((feature) => {
    const geometry = featureGeometry(feature);
    return geometry?.type === "Point";
  });

  return allPoints ? features : null;
}

function featurePosition(feature) {
  const geometry = featureGeometry(feature);
  return geometry?.type === "Point" && Array.isArray(geometry.coordinates)
    ? geometry.coordinates
    : [Number.NaN, Number.NaN];
}

function pointLayerData(dataProps) {
  const data = dataProps?.data;
  return Array.isArray(data) ? data : null;
}

function layerAllowsAdaptiveClustering(layer) {
  return (
    layer?.config?.readOnly !== true &&
    layer?.config?.technicalReadOnly !== true &&
    layer?.config?.animation?.enabled !== true
  );
}

function clusterablePointData(data, getPosition) {
  if (
    !Array.isArray(data) ||
    data.length > MAX_CLIENT_POINT_COUNT ||
    typeof getPosition !== "function"
  ) {
    return null;
  }

  // O ClusterBuilder nativo elimina coordenadas inválidas individualmente.
  // Não aplicamos uma segunda regra de razão mínima que mudaria o conjunto
  // agregado em relação ao comportamento do Kepler.
  return data.filter((point) => {
    const position = getPosition(point);
    return (
      Array.isArray(position) &&
      Number.isFinite(Number(position[0])) &&
      Number.isFinite(Number(position[1]))
    );
  });
}

function runtimeMode(layer, mapState, policy) {
  const nextMode = resolvePointClusterMode({
    zoom: mapState?.zoom,
    previousMode: layer.__maonoPointClusterMode,
    policy,
  });
  layer.__maonoPointClusterMode = nextMode;
  return nextMode;
}

function clusterDeckProps({
  layer,
  opts,
  policy,
  data,
  getPosition,
}) {
  const defaultLayerProps = layer.getDefaultDeckLayerProps(opts);
  const mapState = opts?.mapState ?? {};
  const { _filterData: _nativeFilterData, ...formattedData } = opts?.data ?? {};
  const filterData = buildNativePointClusterFilter({
    dataProps: opts?.data,
    gpuFilter: opts?.gpuFilter,
  });

  return {
    ...defaultLayerProps,
    id: adaptiveClusterDeckLayerId(layer.id),
    ...formattedData,
    data,
    getPosition,
    filterData,
    radiusScale: 1,
    // clusterRadius define a topologia do agrupamento; radiusRange define apenas
    // o tamanho visual. Mantemos os dois contratos independentes como no Kepler.
    radiusRange: NATIVE_CLUSTER_RADIUS_RANGE,
    clusterRadius: policy.clusterSize,
    colorRange: clusterColorRange(layer),
    colorScaleType: "quantize",
    getColorValue: (points) => points.length,
    zoom: Math.round(Number(mapState.zoom ?? 0)),
    width: Number(mapState.width ?? 0),
    height: Number(mapState.height ?? 0),
    opacity: Number(layer?.config?.visConfig?.opacity ?? 0.8),
    pickable: true,
    autoHighlight: true,
    updateTriggers: {
      getPosition: {
        columns: layer?.config?.columns,
        columnMode: layer?.config?.columnMode,
      },
      filterData: {
        filterRange: opts?.gpuFilter?.filterRange,
        ...(opts?.gpuFilter?.filterValueUpdateTriggers ?? {}),
        filteredIndex: opts?.data?.getFiltered,
      },
    },
    // O domínio é calculado somente pela subcamada transitória. Não o
    // escrevemos de volta na configuração persistida da camada lógica.
    onSetColorDomain: undefined,
  };
}

export class MaonoCountedDeckClusterLayer extends DeckGLClusterLayer {
  static layerName = "MaonoCountedDeckClusterLayer";

  renderLayers() {
    const nativeLayer = super.renderLayers();
    const { id, visible, opacity } = this.props;
    const data =
      this.state?.cpuAggregator?.state?.layerData?.data ?? [];
    const labels = data.filter(
      (cell) => visiblePointCount(cell) > 1,
    );

    return [
      nativeLayer,
      new TextLayer({
        id: `${id}-count-labels`,
        data: labels,
        visible,
        opacity,
        pickable: false,
        billboard: true,
        sizeUnits: "pixels",
        getPosition: (cell) => cell.position,
        getText: (cell) => String(visiblePointCount(cell)),
        getSize: 13,
        getColor: [255, 255, 255, 255],
        getTextAnchor: "middle",
        getAlignmentBaseline: "center",
        fontFamily:
          'Inter, "Helvetica Neue", Arial, sans-serif',
        fontWeight: 700,
        outlineWidth: 2,
        outlineColor: [0, 0, 0, 150],
        parameters: {
          depthMask: false,
        },
        updateTriggers: {
          getText:
            this._getSublayerUpdateTriggers?.() ?? {},
        },
      }),
    ];
  }
}

function renderClusters(args) {
  const ClusterLayerClass = args.policy.showCount
    ? MaonoCountedDeckClusterLayer
    : DeckGLClusterLayer;

  return [
    new ClusterLayerClass(clusterDeckProps(args)),
  ];
}

export class MaonoAdaptivePointLayer extends LayerClasses.point {
  renderLayer(opts) {
    const policy = POINT_CLUSTERING_FEATURE_ENABLED
      ? getPointClusterPolicy(this.id)
      : null;

    if (
      !policy?.enabled ||
      !layerAllowsAdaptiveClustering(this) ||
      runtimeMode(this, opts?.mapState, policy) !== "cluster"
    ) {
      this.__maonoPointClusterMode = "points";
      return super.renderLayer(opts);
    }

    const rawData = pointLayerData(opts?.data);
    const getPosition = opts?.data?.getPosition;
    const data = clusterablePointData(rawData, getPosition);
    if (!data) {
      this.__maonoPointClusterMode = "points";
      return super.renderLayer(opts);
    }

    return renderClusters({
      layer: this,
      opts,
      policy,
      data,
      getPosition,
    });
  }

  getHoverData(object, dataContainer, ...rest) {
    if (clusterPoints(object)) {
      return clusterHoverData(object, dataContainer);
    }
    return super.getHoverData(object, dataContainer, ...rest);
  }
}

export class MaonoAdaptiveGeoJsonLayer extends LayerClasses.geojson {
  renderLayer(opts) {
    const policy = POINT_CLUSTERING_FEATURE_ENABLED
      ? getPointClusterPolicy(this.id)
      : null;

    if (
      !policy?.enabled ||
      !layerAllowsAdaptiveClustering(this) ||
      runtimeMode(this, opts?.mapState, policy) !== "cluster"
    ) {
      this.__maonoPointClusterMode = "points";
      return super.renderLayer(opts);
    }

    const data = pointFeatureData(opts?.data?.data);
    if (!data) {
      this.__maonoPointClusterMode = "points";
      return super.renderLayer(opts);
    }

    return renderClusters({
      layer: this,
      opts,
      policy,
      data,
      getPosition: featurePosition,
    });
  }

  getHoverData(object, dataContainer, ...rest) {
    if (clusterPoints(object)) {
      return clusterHoverData(object, dataContainer);
    }
    return super.getHoverData(object, dataContainer, ...rest);
  }
}
