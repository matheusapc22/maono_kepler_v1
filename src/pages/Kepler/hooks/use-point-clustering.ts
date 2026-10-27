
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { useDispatch, useSelector } from "react-redux";
import type { KeplerGlState } from "@kepler.gl/reducers";
import type { VisState } from "@kepler.gl/schemas";
import type { Layer } from "@kepler.gl/layers";
import type { PointClusterMode } from "../clustering/point-cluster-policy.ts";
import { updateMap } from "@kepler.gl/actions";

import {
  adaptiveClusterDeckLayerId,
  resolveClusterClick,
} from "../clustering/point-cluster-controller.ts";
import {
  getPointClusterEligibility,
} from "../clustering/point-cluster-eligibility.ts";
import {
  getAdaptivePointClusterDefaults,
  isPointClusteringFeatureEnabled,
  resolvePointClusterMode,
} from "../clustering/point-cluster-policy.ts";
import {
  getPointClusterSnapshot,
  prunePointClusterLayerPolicies,
  subscribePointClusterStore,
  updatePointClusterLayerPolicy,
} from "../clustering/point-cluster-store.ts";
import { emitPointClusterTelemetry } from "../clustering/performance-telemetry.ts";

const POINT_CLUSTERING_FEATURE_ENABLED =
  isPointClusteringFeatureEnabled(
    import.meta.env.VITE_POINT_CLUSTERING_V1,
  );
const LOGICAL_POINT_LAYER_TYPES = new Set<string | null>([
  "point",
  "geojson",
]);

type ClusterRootState = {
  demo?: { keplerGl?: { map?: Partial<KeplerGlState> }; app?: { isMapLoading?: boolean } };
};

function datasetForLayer(datasets: VisState["datasets"], layer: Layer) {
  const dataId = layer?.config?.dataId;
  if (Array.isArray(dataId)) {
    return datasets?.[dataId[0]];
  }
  return datasets?.[dataId];
}

function clickedDeckLayerId(clicked: { layer?: { id?: string }; sourceLayer?: { id?: string } } | null | undefined) {
  return clicked?.layer?.id ?? clicked?.sourceLayer?.id;
}

export function usePointClustering() {
  const dispatch = useDispatch();
  const storeSnapshot = useSyncExternalStore(
    subscribePointClusterStore,
    getPointClusterSnapshot,
    getPointClusterSnapshot,
  );
  const mapState = useSelector(
    (state: ClusterRootState): Partial<KeplerGlState["mapState"]> => state?.demo?.keplerGl?.map?.mapState ?? {},
  );
  const visState = useSelector(
    (state: ClusterRootState): Partial<VisState> => state?.demo?.keplerGl?.map?.visState ?? {},
  );
  const isMapLoading = useSelector(
    (state: ClusterRootState) => state?.demo?.app?.isMapLoading === true,
  );
  const layers = visState.layers ?? [];
  const datasets = visState.datasets ?? {};
  const clicked = visState.clicked;
  const previousModesRef = useRef(new Map<string, PointClusterMode>());
  const handledClickRef = useRef<VisState["clicked"]>(null);

  useEffect(() => {
    if (isMapLoading || layers.length === 0) {
      return;
    }

    prunePointClusterLayerPolicies(
      layers
        .filter((layer) => LOGICAL_POINT_LAYER_TYPES.has(layer?.type))
        .map((layer) => layer.id),
    );
  }, [isMapLoading, layers]);

  const catalog = useMemo(() => {
    return layers
      .filter((layer) =>
        LOGICAL_POINT_LAYER_TYPES.has(layer?.type),
      )
      .map((layer) => {
        const dataset = datasetForLayer(datasets, layer);
        const eligibility = getPointClusterEligibility(
          layer,
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
  ]);

  useEffect(() => {
    if (!POINT_CLUSTERING_FEATURE_ENABLED) {
      previousModesRef.current.clear();
      return;
    }

    const activeLayerIds = new Set(
      catalog.map(({ pointLayerId }) => pointLayerId),
    );
    for (const pointLayerId of previousModesRef.current.keys()) {
      if (!activeLayerIds.has(pointLayerId)) {
        previousModesRef.current.delete(pointLayerId);
      }
    }

    for (const item of catalog) {
      const policy = item.policy;
      const previousMode = previousModesRef.current.get(
        item.pointLayerId,
      );
      const nextMode =
        policy?.enabled && item.eligibility.eligible
          ? resolvePointClusterMode({
              zoom: mapState.zoom,
              previousMode,
              policy,
            })
          : "points";

      if (previousMode !== nextMode) {
        previousModesRef.current.set(
          item.pointLayerId,
          nextMode,
        );
        emitPointClusterTelemetry({
          event: "mode_changed",
          pointCount: item.eligibility.pointCount,
          mode: nextMode,
        });
      }
    }
  }, [catalog, mapState.zoom]);

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
      extension: storeSnapshot.extension,
    });

    if (!viewport) {
      return;
    }

    dispatch(updateMap(viewport));
    const deckLayerId = clickedDeckLayerId(clicked);
    const catalogItem = catalog.find(
      ({ pointLayerId }) => {
        const runtimeId = adaptiveClusterDeckLayerId(
          pointLayerId,
        );
        return (
          deckLayerId === runtimeId ||
          String(deckLayerId ?? "").startsWith(
            `${runtimeId}-`,
          )
        );
      },
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
  ]);

  const updateLayerPolicy = useCallback(
    (
      pointLayerId: Parameters<typeof updatePointClusterLayerPolicy>[0],
      patch: Parameters<typeof updatePointClusterLayerPolicy>[1],
      pointCount?: Parameters<typeof updatePointClusterLayerPolicy>[2],
    ) => {
      updatePointClusterLayerPolicy(
        pointLayerId,
        patch,
        pointCount,
      );

      // A política vive fora do Redux. Reemitimos o mesmo zoom apenas para
      // solicitar um novo frame do Kepler, sem mudar a câmera ou a revisão
      // persistida do projeto.
      dispatch(
        updateMap({
          zoom: Number(mapState.zoom ?? 0),
        }),
      );
    },
    [dispatch, mapState.zoom],
  );

  return {
    featureEnabled: POINT_CLUSTERING_FEATURE_ENABLED,
    layers: catalog,
    updateLayerPolicy,
  };
}
