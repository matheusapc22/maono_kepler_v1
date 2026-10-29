import { createContext, useContext } from "react";
import type { KeplerEngineAdapterValue } from "./types";

export const KeplerEngineAdapterContext = createContext<KeplerEngineAdapterValue | null>(null);

export function useKeplerEngineAdapter() {
  const value = useContext(KeplerEngineAdapterContext);

  if (!value) {
    throw new Error(
      "useKeplerEngineAdapter deve ser usado dentro de KeplerEngineAdapterProvider.",
    );
  }

  return value;
}
