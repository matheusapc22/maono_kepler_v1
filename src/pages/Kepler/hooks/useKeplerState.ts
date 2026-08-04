import { useMemo } from "react";

import { useKeplerEngineAdapter } from "../engine-adapter/index.ts";
import {
  toMaonoFilterSnapshot,
  toMaonoLayerSnapshot,
} from "../integration/keplerBridge.ts";

/**
 * Facade de leitura compatível com o painel atual.
 * Não acessa Redux e não expõe objetos mutáveis do Kepler.
 */
export function useKeplerState() {
  const { state } = useKeplerEngineAdapter();

  return useMemo(
    () => ({
      ...state,
      layers: state.layers.map(toMaonoLayerSnapshot),
      filters: state.filters.map(toMaonoFilterSnapshot),
      datasets: state.datasets,
    }),
    [state],
  );
}
