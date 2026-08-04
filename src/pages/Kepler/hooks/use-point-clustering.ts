// @ts-nocheck

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  addLayer,
  layerToggleVisibility,
  layerVisConfigChange,
  updateMap,
} from "@kepler.gl/actions";
import {
  buildPointClusterLayerConfig,
  findCompatibleClusterLayer,
  resolveClusterClick,
  resolveVisibilityChanges,
} from "../clustering/point-cluster-controller.ts";
import {
  getPointClusterEligibility,
} from "../clustering/point-cluster-eligibility.ts";
import {
  getAdaptivePointClusterDefaults,
  isPointClusteringFeatureEnabled,
} from "../clustering/point-cluster-policy.ts";
import {
  getPointClusterSnapshot,
  registerPointClusterPair,
  subscribePointClusterStore,
  updatePointClusterLayerPolicy,
} from "../clustering/point-cluster-store.ts";
import { emitPointClusterTelemetry } from "../clustering/performance-telemetry.ts";

const POINT_CLUSTERING_FEATURE_ENABLED =
  isPointClusteringFeatureEnabled(
    import.meta.env.VITE_POINT_CLUSTERING_V1,
  );
const POINT_SOURCE_LAYER_TYPES = new Set([
  "point",
  "cluster",
  "heatmap",
  "geojson",
]);

function datasetForLayer(datasets, layer) {
  const dataId = layer?.config?.dataId;
  if (Array.isArray(dataId)) {
    return datasets?.[dataId[0]];
  }
  return datasets?.[dataId];
}

function pointEligibilityLayer(layer) {
  return ["cluster", "heatmap"].includes(layer?.type)
    ? { ...layer, type: "point" }
    : layer;
}

export function usePointClustering() {
  const dispatch = useDispatch();
  const storeSnapshot = useSyncExternalStore(
    subscribePointClusterStore,
    getPointClusterSnapshot,
    getPointClusterSnapshot,
  );
  const mapState = useSelector(
    (state) => state?.demo?.keplerGl?.map?.mapState ?? {},
  );
  const visState = useSelector(
    (state) => state?.demo?.keplerGl?.map?.visState ?? {},
  );
  const layers = visState.layers ?? [];
  const datasets = visState.datasets ?? {};
  const clicked = visState.clicked;
  const previousModesRef = useRef(new Map());
  const handledClickRef = useRef(null);

  const catalog = useMemo(() => {
    const pairedClusterLayerIds = new Set(
      storeSnapshot.pairs.map(({ clusterLayerId }) => clusterLayerId),
    );

    return layers
      .filter(
        (layer) =>
          POINT_SOURCE_LAYER_TYPES.has(layer?.type) &&
          !String(layer?.id ?? "").startsWith("maono-cluster-") &&
          !pairedClusterLayerIds.has(layer?.id),
      )
      .map((layer) => {
        const dataset = datasetForLayer(datasets, layer);
        const eligibility = getPointClusterEligibility(
          pointEligibilityLayer(layer),
          dataset,
          { minimumPointCount: 1 },
        );
        const policy =
          storeSnapshot.extension.layers[layer.id] ?? null;
        const defaults = getAdaptivePointClusterDefaults(
          eligibility.pointCount,
        );

        return {
          pointLayerId: layer.id,
          label: layer?.config?.label ?? "Camada de pontos",
          policy,
          defaults,
          eligibility,
        };
      })
      .filter(
        ({ eligibility }) => eligibility.sourceKind !== "unsupported",
      );
  }, [
    datasets,
    layers,
    storeSnapshot.extension,
    storeSnapshot.pairs,
  ]);

  useEffect(() => {
    if (!POINT_CLUSTERING_FEATURE_ENABLED) {
      return;
    }

    for (const [pointLayerId, policy] of Object.entries(
      storeSnapshot.extension.layers,
    )) {
      const pointLayer = layers.find(
        (layer) => layer.id === pointLayerId,
      );
      if (!pointLayer) {
        continue;
      }

      const dataset = datasetForLayer(datasets, pointLayer);
      const eligibility = getPointClusterEligibility(
        pointEligibilityLayer(pointLayer),
        dataset,
        { minimumPointCount: 1 },
      );
      let clusterLayer = findCompatibleClusterLayer(
        pointLayer,
        layers,
      );

      if (policy.enabled && !eligibility.eligible) {
        if (clusterLayer?.config?.isVisible) {
          dispatch(
            layerToggleVisibility(clusterLayer.id, false),
          );
        }
        if (!pointLayer.config?.isVisible) {
          dispatch(
            layerToggleVisibility(pointLayer.id, true),
          );
        }
        previousModesRef.current.set(
          pointLayerId,
          "points",
        );
        continue;
      }

      if (policy.enabled && !clusterLayer) {
        const startedAt = performance.now();
        dispatch(
          addLayer(
            buildPointClusterLayerConfig({
              pointLayer,
              policy,
              isVisible: false,
              latitudeColumn:
                eligibility.latitudeColumn,
              longitudeColumn:
                eligibility.longitudeColumn,
              geoJsonColumn:
                eligibility.geoJsonColumn,
            }),
          ),
        );
        emitPointClusterTelemetry({
          event: "pair_created",
          pointCount: eligibility.pointCount,
          durationMs: performance.now() - startedAt,
        });
        continue;
      }

      if (!clusterLayer) {
        continue;
      }

      registerPointClusterPair({
        pointLayerId,
        clusterLayerId: clusterLayer.id,
      });

      if (
        clusterLayer.config?.visConfig?.clusterRadius !==
        policy.clusterSize
      ) {
        dispatch(
          layerVisConfigChange(clusterLayer, {
            clusterRadius: policy.clusterSize,
            radiusRange: [
              8,
              Math.max(40, policy.clusterSize),
            ],
          }),
        );
      }

      const previousMode =
        previousModesRef.current.get(pointLayerId);
      const { nextMode, changes } =
        resolveVisibilityChanges({
          pointLayer,
          clusterLayer,
          zoom: mapState.zoom,
          previousMode,
          policy,
        });

      if (previousMode !== nextMode) {
        previousModesRef.current.set(
          pointLayerId,
          nextMode,
        );
        emitPointClusterTelemetry({
          event: "mode_changed",
          pointCount: eligibility.pointCount,
          mode: nextMode,
        });
      }

      for (const change of changes) {
        dispatch(
          layerToggleVisibility(
            change.layerId,
            change.isVisible,
          ),
        );
      }
    }
  }, [
    datasets,
    dispatch,
    layers,
    mapState.zoom,
    storeSnapshot.extension,
  ]);

  useEffect(() => {
    if (
      !POINT_CLUSTERING_FEATURE_ENABLED ||
      !clicked ||
      handledClickRef.current === clicked
    ) {
      return;
    }

    handledClickRef.current = clicked;
    const viewport = resolveClusterClick({
      clicked,
      mapState,
      pairs: storeSnapshot.pairs,
      extension: storeSnapshot.extension,
    });

    if (!viewport) {
      return;
    }

    dispatch(updateMap(viewport));
    const pair = storeSnapshot.pairs.find(
      ({ clusterLayerId }) =>
        clicked?.layer?.id === clusterLayerId ||
        clicked?.layer?.id?.startsWith(
          `${clusterLayerId}-`,
        ),
    );
    const catalogItem = catalog.find(
      ({ pointLayerId }) =>
        pointLayerId === pair?.pointLayerId,
    );
    emitPointClusterTelemetry({
      event: "cluster_clicked",
      pointCount:
        catalogItem?.eligibility?.pointCount ?? 0,
    });
  }, [
    catalog,
    clicked,
    dispatch,
    mapState,
    storeSnapshot.extension,
    storeSnapshot.pairs,
  ]);

  return {
    featureEnabled: POINT_CLUSTERING_FEATURE_ENABLED,
    layers: catalog,
    updateLayerPolicy: updatePointClusterLayerPolicy,
  };
}
