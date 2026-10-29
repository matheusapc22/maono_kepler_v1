import type { ComponentProps } from "react";
// SPDX-License-Identifier: MIT

import styled from "styled-components";

import { MapControlFactory } from "@kepler.gl/components";

/**
 * A Maõno possui seus próprios controles de mapa. Mantemos o MapLegendPanel
 * montado apenas para que a legenda customizada possa abrir via estado, mas o
 * botão nativo correspondente e todos os demais botões do Kepler ficam fora da
 * interface.
 */
const NativeControlHost = styled.div`
  position: absolute;
  top: 0;
  right: 0;
  width: 0;
  height: 0;
  overflow: visible;
  pointer-events: none;
  z-index: 1;

  .map-control {
    width: 0;
    height: 0;
    padding: 0;
    margin: 0;
    overflow: visible;
    pointer-events: none;
  }

  .map-control .map-control-button,
  .map-control .show-legend {
    display: none;
  }
`;

CustomMapControlFactory.deps = MapControlFactory.deps;

export function CustomMapControlFactory(...deps: Parameters<typeof MapControlFactory>) {
  const MapControl = MapControlFactory(...deps);
  const MapLegendPanel = deps[3];

  const CustomMapControl = (props: ComponentProps<ReturnType<typeof MapControlFactory>>) => (
    <NativeControlHost data-maono-kepler-controls="hidden">
      <MapControl
        {...props}
        top={0}
        actionComponents={MapLegendPanel ? [MapLegendPanel] : []}
      />
    </NativeControlHost>
  );

  CustomMapControl.displayName = "MaonoHiddenNativeMapControls";
  return CustomMapControl;
}
