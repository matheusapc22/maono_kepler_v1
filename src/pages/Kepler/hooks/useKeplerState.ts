import { useMemo } from "react";

import { useKeplerEngineAdapter } from "../engine-adapter/index.ts";
import type {
  MaonoDatasetSnapshot,
  MaonoFilterSnapshot,
  MaonoLayerSnapshot,
} from "../integration/keplerBridge.ts";

export function useKeplerState() {
  const { state } = useKeplerEngineAdapter();

  return useMemo(
    () => ({
      ...state,
      layers: state.layers.map(
        (layer): MaonoLayerSnapshot => ({
          ...layer,
          color: layer.style.color,
          opacity: layer.style.opacity,
          dataId:
            layer.dataIds.length > 1
              ? layer.dataIds
              : (layer.dataIds[0] ?? null),
        }),
      ),
      filters: state.filters.map(
        (filter): MaonoFilterSnapshot => ({
          ...filter,
          dataId:
            filter.dataIds.length > 1
              ? filter.dataIds
              : (filter.dataIds[0] ?? null),
          name:
            filter.fieldNames.length > 1
              ? filter.fieldNames
              : (filter.fieldNames[0] ?? null),
        }),
      ),
      datasets: state.datasets as MaonoDatasetSnapshot[],
    }),
    [state],
  );
}
