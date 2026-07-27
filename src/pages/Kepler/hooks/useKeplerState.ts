import { useMemo } from "react";
import { useSelector } from "react-redux";

import {
  normalizeKeplerDatasets,
  normalizeKeplerFilters,
  normalizeKeplerLayers,
  selectKeplerVisState,
} from "../integration/keplerBridge";

export function useKeplerState() {
  const visState = useSelector(selectKeplerVisState);

  return useMemo(
    () => ({
      layers: normalizeKeplerLayers(visState?.layers),
      filters: normalizeKeplerFilters(visState?.filters),
      datasets: normalizeKeplerDatasets(visState?.datasets),
      hasData: Boolean(
        visState?.datasets &&
          (
            typeof visState.datasets.size === "number"
              ? visState.datasets.size > 0
              : Object.keys(visState.datasets).length > 0
          ),
      ),
    }),
    [visState],
  );
}
