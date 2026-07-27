// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// @ts-nocheck

import { SidePanelFactory } from "@kepler.gl/components";
import MaonoLayerPanelErrorBoundary from "../components/maono-layer-panel/ErrorBoundary";
import MaonoLayerPanel from "../components/maono-layer-panel/MaonoLayerPanel";
import { useMapPanel } from "../map-panel/MapPanelContext";

export function CustomSidePanelFactory(...deps: any[]) {
  const DefaultSidePanel = SidePanelFactory(...deps);

  const Wrapped = (props: any) => {
    const { customLayerPanelEnabled } = useMapPanel();

    if (customLayerPanelEnabled) {
      return (
        <MaonoLayerPanelErrorBoundary
          fallback={<DefaultSidePanel {...props} />}
        >
          <MaonoLayerPanel />
        </MaonoLayerPanelErrorBoundary>
      );
    }

    return <DefaultSidePanel {...props} />;
  };

  (Wrapped as any).deps = (DefaultSidePanel as any).deps;
  return Wrapped;
}

CustomSidePanelFactory.deps = SidePanelFactory.deps;

export function replaceSidePanel() {
  return [SidePanelFactory, CustomSidePanelFactory];
}
