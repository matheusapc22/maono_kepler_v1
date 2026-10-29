import React from 'react';
import {MapPanelContext,type MapPanelRuntimeContext} from './map-panel-context';
export type {MapPanelRuntimeContext} from './map-panel-context';

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
