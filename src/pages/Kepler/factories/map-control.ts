import { MapControlFactory } from "@kepler.gl/components";
import { CustomMapControlFactory } from "./map-control.tsx";

export { CustomMapControlFactory };

export function replaceMapControl() {
  return [MapControlFactory, CustomMapControlFactory];
}
