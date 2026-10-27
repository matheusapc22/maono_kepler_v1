import type { ComponentProps } from "react";
// SPDX-License-Identifier: MIT

import { LegendRowFactory } from "@kepler.gl/components";

import { formatMaonoLegendLabel } from "./maono-legend-format";

MaonoLegendRowFactory.deps = LegendRowFactory.deps;

export function MaonoLegendRowFactory(...deps: Parameters<typeof LegendRowFactory>) {
  const NativeLegendRow = LegendRowFactory(...deps);

  const MaonoLegendRow = (props: ComponentProps<ReturnType<typeof LegendRowFactory>>) => (
    <NativeLegendRow
      {...props}
      label={formatMaonoLegendLabel(props.label)}
    />
  );

  MaonoLegendRow.displayName = "MaonoLegendRow";
  return MaonoLegendRow;
}
