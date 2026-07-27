// @ts-nocheck

import { TextLayer } from "@deck.gl/layers";
import { DeckGLClusterLayer } from "@kepler.gl/deckgl-layers";
import { LayerClasses } from "@kepler.gl/layers";
import { getPointClusterPolicyForClusterLayer } from "./point-cluster-store.ts";

function visiblePointCount(cell) {
  return Array.isArray(cell?.filteredPoints)
    ? cell.filteredPoints.length
    : Array.isArray(cell?.points)
      ? cell.points.length
      : Number(cell?.pointCount ?? 0);
}

function pointCoordinates(value) {
  let candidate = value;

  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return [Number.NaN, Number.NaN];
    }
  }

  const geometry =
    candidate?.type === "Feature"
      ? candidate.geometry
      : candidate?.geometry ?? candidate;

  return geometry?.type === "Point" &&
    Array.isArray(geometry.coordinates)
    ? [
        Number(geometry.coordinates[0]),
        Number(geometry.coordinates[1]),
      ]
    : [Number.NaN, Number.NaN];
}

export class MaonoDeckGLClusterLayer extends DeckGLClusterLayer {
  static layerName = "MaonoDeckGLClusterLayer";

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

export function createCountedClusterLayer(nativeLayer) {
  // deck.gl keeps normalized props on a prototype-backed object. Spreading
  // nativeLayer.props drops non-enumerable values such as `data`, leaving the
  // counted layer empty. Passing the props object itself preserves them.
  return new MaonoDeckGLClusterLayer(nativeLayer.props);
}

export default class MaonoClusterLayer extends LayerClasses.cluster {
  constructor(props) {
    super(props);
    const getNativePositionAccessor =
      this.getPositionAccessor;

    this.getPositionAccessor = (dataContainer) => {
      const geoJsonColumn =
        this.config?.columns?.geojson;

      if (geoJsonColumn?.fieldIdx >= 0) {
        return (item) =>
          pointCoordinates(
            dataContainer.valueAt(
              item.index,
              geoJsonColumn.fieldIdx,
            ),
          );
      }

      return getNativePositionAccessor(dataContainer);
    };
  }

  get requiredLayerColumns() {
    return this.config?.columnMode === "geojson" ||
      this.config?.columns?.geojson
      ? ["geojson"]
      : super.requiredLayerColumns;
  }

  get columnPairs() {
    return this.config?.columnMode === "geojson" ||
      this.config?.columns?.geojson
      ? null
      : super.columnPairs;
  }

  renderLayer(opts) {
    const renderedLayers = super.renderLayer(opts);
    const nativeLayer = renderedLayers[0];
    const policy = getPointClusterPolicyForClusterLayer(
      this.id,
    );

    if (!policy?.showCount || !nativeLayer) {
      return renderedLayers;
    }

    return [
      createCountedClusterLayer(nativeLayer),
      ...renderedLayers.slice(1),
    ];
  }
}
