import { LegendRowFactory } from "@kepler.gl/components";
import { MaonoLegendRowFactory } from "./maono-legend-row.tsx";

export { MaonoLegendRowFactory };
export { parseKeplerLegendNumber, formatMaonoLegendNumber, formatMaonoLegendLabel } from "./maono-legend-format";

export function replaceLegendRow() {
  return [LegendRowFactory, MaonoLegendRowFactory];
}
