import type { ComponentProps } from "react";
// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project

import { SidePanelFactory } from "@kepler.gl/components";
import { useMapPanel } from "../map-panel/MapPanelContext.ts";

export function CustomSidePanelFactory(...deps: Parameters<typeof SidePanelFactory>) {
  const DefaultSidePanel = SidePanelFactory(...deps);

  const Wrapped = (props: ComponentProps<ReturnType<typeof SidePanelFactory>>) => {
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
