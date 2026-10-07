import { normalizePointClusterLayerPolicy, normalizePointClusteringExtension } from "./point-cluster-policy.ts";

/** Local immutable receipts. These references/generation tokens never enter the
 * serialized Maono config, logs, metrics or an upload. */
export type PointClusterCaptureExpectation = {
  policies: Readonly<Record<string, string>>;
  requiredByView: Readonly<Record<number, readonly string[]>>;
};
type Receipt = Readonly<{
  logicalId: string;
  policyKey: string | null;
  sourceLayer: any;
  sourceData: any;
  sourceDataset: any;
  sourceGpuFilter: any;
  renderData: any;
  renderProps: any;
  mode: "points" | "cluster";
  materializable: boolean;
  generation: object;
}>;
export type PointClusterLayerWitness = Readonly<{ layer: any; receipt: Receipt; sourceMatches: boolean; drawnData?: object | null }>;
const producedLayers = new WeakMap<object, Receipt>();
const appliedLayers = new WeakMap<object, { generation: object; data: object }>();
const producedData = new WeakMap<object, object>();

export function pointClusterPolicyKey(policy: unknown): string | null {
  if (!policy || typeof policy !== "object") return null;
  const value = normalizePointClusterLayerPolicy(policy);
  return JSON.stringify([value.enabled, value.clusterMaxZoom, value.hysteresis, value.clusterSize, value.showCount]);
}

export function pointClusterCaptureExpectation(savedMaono: any, savedLayers: any[], state: any, savedDatasets: any[] = []): PointClusterCaptureExpectation {
  const policies = normalizePointClusteringExtension(savedMaono?.pointClustering).layers;
  const visible = new Set(savedLayers.filter(layer => layer?.config?.isVisible !== false && layer?.isVisible !== false).map(layer => String(layer.id)));
  const keys = Object.fromEntries(Object.entries(policies).map(([id, value]) => [id, pointClusterPolicyKey(value)!]));
  const requiredByView: Record<number, readonly string[]> = {};
  const nativeLayers = state?.visState?.layers || [], nativeData = state?.visState?.layerData || [];
  const nativeEmpty = (id: string) => {
    const index = nativeLayers.findIndex((layer: any) => String(layer?.id) === id);
    const layer = nativeLayers[index], data = nativeData[index];
    const savedLayer = savedLayers.find(item => String(item?.id) === id);
    const dataId = savedLayer?.config?.dataId;
    const ids = (item: any) => [item?.data?.id, item?.info?.id, item?.id].filter(value => value != null && value !== "").map(String);
    const matching = savedDatasets.filter(item => dataId && ids(item).includes(String(dataId)));
    const dataset = matching.length === 1 && ids(matching[0]).every(id => id === String(dataId)) ? matching[0] : null;
    // An empty prepared layerData can be transient even when saved rows exist.
    // Omit only a positively identified empty saved dataset, never unknown or
    // filtered nonempty input. Native references and a fresh draw still match.
    const representations = ["allData", "rows"].filter(key => Object.hasOwn(dataset?.data || {}, key));
    const savedEmpty = representations.length > 0 && representations.every(key => Array.isArray(dataset.data[key]) && dataset.data[key].length === 0);
    return savedEmpty && Array.isArray(data?.data) && data.data.length === 0
      && typeof layer?.shouldRenderLayer === "function" && layer.shouldRenderLayer(data) === false;
  };
  for (const index of state?.mapState?.isSplit ? [0, 1] : [0]) {
    const scope = state?.mapState?.isSplit ? state?.visState?.splitMaps?.[index]?.layers : null;
    requiredByView[index] = Object.freeze(Object.keys(keys).filter(id => visible.has(id) && !nativeEmpty(id) && (!scope || Boolean(scope[id]))));
  }
  return Object.freeze({ policies: Object.freeze(keys), requiredByView: Object.freeze(requiredByView) });
}

function flattenLayers(value: any): any[] {
  return Array.isArray(value) ? value.flatMap(flattenLayers) : value && typeof value === "object" ? [value] : [];
}

/** Call only at adaptive renderLayer construction. In particular, an already
 * emitted/cached Deck object cannot be relabelled by a later policy or callback. */
export function recordPointClusterLayerProduction(layers: any, logicalLayer: any, opts: any, policy: unknown,
  mode: "points" | "cluster", materializable = true) {
  const policyKey = pointClusterPolicyKey(policy);
  for (const layer of flattenLayers(layers)) {
    if (producedLayers.has(layer)) continue;
    producedLayers.set(layer, Object.freeze({ logicalId: String(logicalLayer.id), policyKey, sourceLayer: logicalLayer,
      sourceData: opts?.data, sourceDataset: opts?.dataset, sourceGpuFilter: opts?.gpuFilter,
      renderData: layer.props?.data, renderProps: layer.props, mode, materializable, generation: Object.freeze({}) }));
  }
  return layers;
}

export function pointClusterLayerReceipt(layer: any) { return producedLayers.get(layer); }

/** Called only after native CPU aggregation updateState returns. The installed
 * implementation is synchronous; a new radius/data/filter generation forces a
 * fresh builder below. Reusing an older produced array cannot mint a new proof. */
export function recordPointClusterMaterialization(layer: any) {
  const receipt = producedLayers.get(layer);
  const data = layer.state?.cpuAggregator?.state?.layerData?.data;
  if (!receipt || receipt.mode !== "cluster" || !Array.isArray(data) || layer.props !== receipt.renderProps || layer.props?.data !== receipt.renderData) return false;
  const previousProducer = producedData.get(data);
  if (previousProducer && previousProducer !== receipt.generation) return false;
  producedData.set(data, receipt.generation);
  appliedLayers.set(layer, { generation: receipt.generation, data });
  return true;
}

function materializedData(layer: any): object | null {
  const receipt = producedLayers.get(layer);
  if (!receipt?.materializable || layer.props !== receipt.renderProps) return null;
  if (receipt.mode === "points") return layer.props?.data === receipt.renderData ? receipt.generation : null;
  const applied = appliedLayers.get(layer);
  const data = layer.state?.cpuAggregator?.state?.layerData?.data;
  return applied && applied.generation === receipt.generation && applied.data === data
    && producedData.get(data) === receipt.generation && layer.props?.data === receipt.renderData ? data : null;
}

export function pointClusterMaterializationCurrent(layer: any) {
  return layer.isLoaded !== false && Boolean(materializedData(layer));
}

export function pointClusterNeedsMaterialization(layer: any) {
  const receipt = producedLayers.get(layer);
  return Boolean(receipt && !materializedData(layer));
}

/** Snapshot the construction receipts, not the external policy store. Native
 * source references must also be the ones this MapContainer actually consumed. */
export function pointClusterLayerWitnesses(layers: any, state: any): readonly PointClusterLayerWitness[] {
  const logical = state?.visState?.layers || [], data = state?.visState?.layerData || [], datasets = state?.visState?.datasets || {};
  return Object.freeze(flattenLayers(layers).flatMap(layer => {
    const receipt = producedLayers.get(layer);
    if (!receipt || layer.props?.visible === false) return [];
    const index = logical.findIndex((item: any) => String(item?.id) === receipt.logicalId);
    const source = logical[index], dataset = source ? datasets[source.config?.dataId] : undefined;
    return [Object.freeze({ layer, receipt, sourceMatches: index >= 0 && source === receipt.sourceLayer && data[index] === receipt.sourceData
      && dataset === receipt.sourceDataset && dataset?.gpuFilter === receipt.sourceGpuFilter })];
  }));
}

/** Freeze the materialization identity at onAfterRender. An update after this
 * point can invalidate a receipt, but cannot upgrade an older drawn frame. */
export function acknowledgePointClusterWitnesses(witnesses: readonly PointClusterLayerWitness[]) {
  return Object.freeze(witnesses.map(witness => Object.freeze({ ...witness,
    drawnData: witness.layer.isLoaded === false ? null : materializedData(witness.layer),
  })));
}

export function pointClusterWitnessesMatch(witnesses: readonly PointClusterLayerWitness[], expected: PointClusterCaptureExpectation, viewIndex: number) {
  if (!expected) return false;
  const represented = new Set<string>();
  for (const witness of witnesses) {
    if (!witness.sourceMatches || !witness.drawnData || witness.layer.isLoaded === false
      || materializedData(witness.layer) !== witness.drawnData) return false;
    if (witness.receipt.policyKey !== (expected?.policies[witness.receipt.logicalId] ?? null)) return false;
    represented.add(witness.receipt.logicalId);
  }
  return (expected?.requiredByView[viewIndex] || []).every(id => represented.has(id));
}
