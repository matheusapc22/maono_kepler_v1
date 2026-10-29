import { SidePanelFactory } from "@kepler.gl/components";
import { CustomSidePanelFactory } from "./side-panel.tsx";

export { CustomSidePanelFactory };

export function replaceSidePanel() {
  return [SidePanelFactory, CustomSidePanelFactory];
}
