// @ts-nocheck

import { TextLayer } from "@deck.gl/layers";
import { DeckGLClusterLayer } from "@kepler.gl/deckgl-layers";
import { LayerClasses } from "@kepler.gl/layers";

import {
  adaptiveClusterDeckLayerId,
} from "./point-cluster-controller.ts";
import {
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
  const allPoints = features.every((feature) => {
    const geometry = featureGeometry(feature);
    return (
      geometry?.type === "Point" &&
      Array.isArray(geometry.coordinates) &&
      Number.isFinite(Number(geometry.coordinates[0])) &&
      Number.isFinite(Number(geometry.coordinates[1]))
    );
  });

  return allPoints ? features : null;
}

function featurePosition(feature) {
  const geometry = featureGeometry(feature);
  return geometry?.type === "Point"
    ? geometry.coordinates
    : [Number.NaN, Number.NaN];
}

function pointLayerData(dataProps) {
  const data = dataProps?.data;
  return Array.isArray(data) ? data : null;
}

function normalizedFilterRanges(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object") {
    return Object.values(value);
  }
  return [];
}

function clusterFilterData(dataProps, gpuFilter) {
  const ranges = normalizedFilterRanges(gpuFilter?.filterRange);
  const getFilterValue = dataProps?.getFilterValue;
  const hasActiveRange = ranges.some(
    (range) =>
      Array.isArray(range) &&
      range.some((value) => Number(value) !== 0),
  );

  if (!hasActiveRange || typeof getFilterValue !== "function") {
    return undefined;
  }

  return (point) => {
    const values = getFilterValue(point);
    return Array.isArray(values) && values.every((value, index) => {
      const range = ranges[index];
      const numeric = Number(value);
      return (
        Array.isArray(range) &&
        Number.isFinite(numeric) &&
        numeric >= Number(range[0]) &&
        numeric <= Number(range[1])
      );
    });
  };
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
  const minimumRadius = Math.max(
    8,
    Math.round(policy.clusterSize * 0.2),
  );
  const maximumRadius = Math.max(40, policy.clusterSize);

  return {
    ...defaultLayerProps,
    id: adaptiveClusterDeckLayerId(layer.id),
    data,
    getPosition,
    filterData: clusterFilterData(opts?.data, opts?.gpuFilter),
    radiusScale: 1,
    radiusRange: [minimumRadius, maximumRadius],
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
      runtimeMode(this, opts?.mapState, policy) !== "cluster"
    ) {
      this.__maonoPointClusterMode = "points";
      return super.renderLayer(opts);
    }

    const data = pointLayerData(opts?.data);
    const getPosition = opts?.data?.getPosition;
    if (!data || typeof getPosition !== "function") {
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
