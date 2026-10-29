import { PanelHeaderFactory } from "@kepler.gl/components";
import { CustomPanelHeaderFactory } from "./panel-header.tsx";

export { CustomPanelHeaderFactory };

export function replacePanelHeader() {
  return [PanelHeaderFactory, CustomPanelHeaderFactory];
}
