// SPDX-License-Identifier: MIT
// @ts-nocheck

import React from "react";
import { createGlobalStyle, ThemeProvider } from "styled-components";

import { MapPopoverFactory } from "@kepler.gl/components";

const MaonoPopoverStableStyles = createGlobalStyle`
  .map-popover {
    border: 1px solid rgba(197, 160, 89, 0.42);
    border-radius: 14px;
    backdrop-filter: blur(16px);
    scrollbar-color: rgba(197, 160, 89, 0.72) transparent;
    scrollbar-width: thin;
  }

  .map-popover::-webkit-scrollbar {
    width: 4px;
    height: 4px;
  }

  .map-popover::-webkit-scrollbar-thumb {
    border-radius: 999px;
    background: rgba(197, 160, 89, 0.72);
  }

  .map-popover .select-geometry {
    margin-top: 10px;
    padding-top: 9px;
    border-top: 1px solid rgba(197, 160, 89, 0.18);
  }
`;

function maonoPopoverTheme(outerTheme = {}) {
  return {
    ...outerTheme,
    activeColor: "#c5a059",
    linkBtnColor: "#f1d28a",
    labelColor: "#8797ad",
    textColor: "#e6edf6",
    textColorHl: "#f8fafc",
    panelBackground: "rgba(8, 12, 19, 0.96)",
    panelBorderColor: "rgba(197, 160, 89, 0.18)",
    panelBoxShadow: "0 22px 52px rgba(0, 0, 0, 0.58)",
    notificationColors: {
      ...(outerTheme.notificationColors || {}),
      success: "#d9b96e",
    },
  };
}

MaonoMapPopoverFactory.deps = MapPopoverFactory.deps;

/**
 * Mantém integralmente o MapPopover oficial: layerHoverProp, campos escolhidos
 * no editor, coordenadas, hover, pin, feature selection e Select Geometry.
 * A substituição Maõno atua somente na apresentação via tema React e na classe
 * estável `.map-popover` publicada pelo próprio Kepler.
 */
export function MaonoMapPopoverFactory(MapPopoverContent) {
  const NativeMapPopover = MapPopoverFactory(MapPopoverContent);

  const MaonoMapPopover = (props) => (
    <ThemeProvider theme={maonoPopoverTheme}>
      <MaonoPopoverStableStyles />
      <NativeMapPopover {...props} />
    </ThemeProvider>
  );

  MaonoMapPopover.displayName = "MaonoMapPopover";
  return MaonoMapPopover;
}

export function replaceMapPopover() {
  return [MapPopoverFactory, MaonoMapPopoverFactory];
}
