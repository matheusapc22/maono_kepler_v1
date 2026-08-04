import React, { createContext, useContext } from "react";

import type {
  MapCapabilities,
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
      {children}
    </MapPanelContext.Provider>
  );
}

export function useMapPanel() {
  const value = useOptionalMapPanel();

  if (!value) {
    throw new Error("useMapPanel deve ser usado dentro de MapPanelProvider.");
  }

  return value;
}

export function useOptionalMapPanel() {
  return useContext(MapPanelContext);
}

export function useMapPanelCapability(capability: keyof MapCapabilities) {
  const value = useOptionalMapPanel();

  return Boolean(
    value?.state.status === "ready" &&
      value.context?.allowed === true &&
      value.context.capabilities[capability] === true,
  );
}
