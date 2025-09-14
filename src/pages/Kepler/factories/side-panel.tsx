// SPDX-License-Identifier: MIT
// Copyright contributors to the kepler.gl project
// @ts-nocheck

import { SidePanelFactory } from "@kepler.gl/components";
import checkAdminUser from "../utils/is-admin-user";

export function CustomSidePanelFactory(...deps: any[]) {
  const DefaultSidePanel = SidePanelFactory(...deps);

  const Wrapped = (props: any) => {
    const isAdminUser = checkAdminUser();

    const EXCLUDED_IDS = !isAdminUser
      ? new Set(["interaction", "interactions"])
      : new Set([]);

    const basePanels =
      props?.panels ?? (DefaultSidePanel as any)?.defaultPanels ?? [];

    const panels = basePanels.filter((p: any) => !EXCLUDED_IDS.has(p?.id));

    return <DefaultSidePanel {...props} panels={panels} />;
  };

  (Wrapped as any).deps = (DefaultSidePanel as any).deps;
  return Wrapped;
}

CustomSidePanelFactory.deps = SidePanelFactory.deps;

export function replaceSidePanel() {
  return [SidePanelFactory, CustomSidePanelFactory];
}
