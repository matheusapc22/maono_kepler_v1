import { MapPopoverFactory } from "@kepler.gl/components";
import { MaonoMapPopoverFactory } from "./maono-map-popover.tsx";

export { MaonoMapPopoverFactory };

export function replaceMapPopover() {
  return [MapPopoverFactory, MaonoMapPopoverFactory];
}
