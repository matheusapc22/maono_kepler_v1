import type {
  MaonoDatasetSnapshot,
  MaonoFilterSnapshot,
  MaonoLayerSnapshot,
} from "../../../integration/keplerBridge.ts";
import {
  resolveLayerSidebarAccent,
  type LayerSidebarAccents,
} from "../layer-sidebar-accents.ts";

export type FilterGroup = {
  key: string;
  label: string;
  dataset: MaonoDatasetSnapshot | null;
  filters: MaonoFilterSnapshot[];
  accent: string;
  layerId: string | null;
};

export const NEUTRAL_FILTER_ACCENT = "var(--maono-layer-muted)";

/** Filters belong to datasets in Kepler. A layer identity is truthful only
 * when exactly one layer uses that dataset. Shared, detached and synchronized
 * filters retain their native grouping and use neutral presentation. */
export function buildFilterGroups(
  filters: MaonoFilterSnapshot[],
  datasets: MaonoDatasetSnapshot[],
  layers: MaonoLayerSnapshot[],
  sidebarAccents?: LayerSidebarAccents,
): FilterGroup[] {
  const byDatasetId = new Map<string, MaonoFilterSnapshot[]>();
  for (const filter of filters) {
    const key = filter.dataIds.length > 1
      ? "__incompatible__"
      : filter.dataIds[0] || "__orphan__";
    byDatasetId.set(key, [...(byDatasetId.get(key) ?? []), filter]);
  }

  const ordered: FilterGroup[] = [];
  const datasetOrder = [...new Set([
    ...layers.flatMap((layer) => layer.dataIds),
    ...datasets.map((dataset) => dataset.id),
  ])];
  for (const datasetId of datasetOrder) {
    const groupFilters = byDatasetId.get(datasetId);
    if (!groupFilters?.length) continue;
    const dataset = datasets.find((item) => item.id === datasetId) ?? null;
    const associatedLayers = layers.filter((layer) => layer.dataIds.includes(datasetId));
    const uniqueLayer = dataset && associatedLayers.length === 1 && associatedLayers[0].dataIds.length === 1
      ? associatedLayers[0]
      : undefined;
    ordered.push({
      key: datasetId,
      label: uniqueLayer?.label ?? dataset?.label ?? "Dados sem camada",
      dataset,
      filters: groupFilters,
      accent: uniqueLayer
        ? resolveLayerSidebarAccent(uniqueLayer.id, sidebarAccents)
        : NEUTRAL_FILTER_ACCENT,
      layerId: uniqueLayer?.id ?? null,
    });
    byDatasetId.delete(datasetId);
  }
  for (const [key, remaining] of byDatasetId) {
    ordered.push({
      key,
      label: key === "__incompatible__" ? "Filtros sincronizados" : "Dados sem camada",
      dataset: null,
      filters: remaining,
      accent: NEUTRAL_FILTER_ACCENT,
      layerId: null,
    });
  }
  return ordered;
}
