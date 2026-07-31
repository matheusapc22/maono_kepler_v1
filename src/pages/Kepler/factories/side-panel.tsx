// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// @ts-nocheck

import { SidePanelFactory } from "@kepler.gl/components";
import { useMapPanel } from "../map-panel/MapPanelContext";

export function CustomSidePanelFactory(...deps: any[]) {
  const DefaultSidePanel = SidePanelFactory(...deps);

  const Wrapped = (props: any) => {
    const {
      context,
      customLayerPanelEnabled,
      customMapShellEnabled,
    } = useMapPanel();
    const shellHostedLayerPanelActive = Boolean(
      context && customLayerPanelEnabled && customMapShellEnabled,
    );

    if (shellHostedLayerPanelActive) {
      return null;
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
