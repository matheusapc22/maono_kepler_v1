// SPDX-License-Identifier: MIT
// @ts-nocheck

import React from "react";
import { LegendRowFactory } from "@kepler.gl/components";

/**
 * Mantém o conteúdo calculado pelo Kepler e localiza somente o separador
 * textual de intervalos. O uso de espaços evita alterar palavras como Toronto.
 */
export function formatMaonoLegendLabel(label) {
  if (typeof label !== "string") return label;
  return label.replace(/\s+to\s+/gi, " a ");
}

MaonoLegendRowFactory.deps = LegendRowFactory.deps;

export function MaonoLegendRowFactory(...deps) {
  const NativeLegendRow = LegendRowFactory(...deps);

  const MaonoLegendRow = (props) => (
    <NativeLegendRow
      {...props}
      label={formatMaonoLegendLabel(props.label)}
    />
  );

  MaonoLegendRow.displayName = "MaonoLegendRow";
  return MaonoLegendRow;
}

export function replaceLegendRow() {
  return [LegendRowFactory, MaonoLegendRowFactory];
}
