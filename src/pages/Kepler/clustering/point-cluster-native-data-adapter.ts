type ClusterFilterArgs = {
  dataProps?: Record<string, any> | null;
  gpuFilter?: Record<string, any> | null;
};

function validFilterRange(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(Number(value[0])) &&
    Number.isFinite(Number(value[1]))
  );
}

/**
 * Reproduz a preparação de filtro CPU usada pelas AggregationLayers do Kepler.
 * A camada lógica continua sendo Point/GeoJSON, mas o Supercluster deve receber
 * exatamente o conjunto que uma ClusterLayer nativa receberia depois dos
 * filtros ativos.
 */
export function buildNativePointClusterFilter({
  dataProps,
  gpuFilter,
}: ClusterFilterArgs) {
  const nativeFilterData = dataProps?._filterData;
  if (typeof nativeFilterData === "function") {
    return nativeFilterData;
  }

  const getFiltered = dataProps?.getFiltered;
  const getFilterValue = dataProps?.getFilterValue;
  const filterRange = gpuFilter?.filterRange;
  const ranges = Array.isArray(filterRange) ? filterRange : [];
  const hasCpuFilter =
    typeof getFiltered === "function" ||
    (typeof getFilterValue === "function" && ranges.length > 0);

  if (!hasCpuFilter) return undefined;

  return (datum: unknown) => {
    if (typeof getFiltered === "function") {
      const included = Number(getFiltered(datum));
      if (Number.isFinite(included) && included <= 0) {
        return false;
      }
    }

    if (typeof getFilterValue !== "function" || ranges.length === 0) {
      return true;
    }

    const values = getFilterValue(datum);
    if (!Array.isArray(values)) return false;

    return values.every((value, index) => {
      const range = ranges[index];
      if (!validFilterRange(range)) return true;
      return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= Number(range[0]) &&
        value <= Number(range[1])
      );
    });
  };
}

export const NATIVE_CLUSTER_RADIUS_RANGE: [number, number] = [1, 40];
