import React, {
  createContext,
  useContext,
} from "react";

import MaonoMapShell from "../components/maono-map-shell/MaonoMapShell";
import type {
  MapPanelContextValue,
  MapPanelLoadState,
} from "./types";

export type MapPanelRuntimeContext = {
  state: MapPanelLoadState;
  context: MapPanelContextValue | null;
  refresh: () => void;
  customLayerPanelEnabled: boolean;
  customMapShellEnabled: boolean;
  customMapOverlayEnabled: boolean;
};

const MapPanelContext = createContext<MapPanelRuntimeContext | null>(null);

export function MapPanelContextProvider({
  value,
  children,
}: {
  value: MapPanelRuntimeContext;
  children: React.ReactNode;
}) {
  return (
    <MapPanelContext.Provider value={value}>
      <MaonoMapShell runtime={value}>{children}</MaonoMapShell>
    </MapPanelContext.Provider>
  );
}

export function useMapPanel() {
  const value = useContext(MapPanelContext);

  if (!value) {
    throw new Error(
      "useMapPanel deve ser usado dentro de MapPanelProvider.",
    );
  }

  return value;
}
