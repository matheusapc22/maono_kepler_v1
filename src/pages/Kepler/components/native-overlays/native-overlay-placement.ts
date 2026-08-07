export type OverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type NativeLegendPlacement = {
  left: number;
  top: number;
};

export const MAONO_LEGEND_HORIZONTAL_RATIO = 0.6;
export const MAONO_LEGEND_VERTICAL_RATIO = 0.12;
export const MAONO_LEGEND_EDGE_MARGIN = 16;

function clamp(value: number, minimum: number, maximum: number) {
  if (maximum < minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Posiciona a legenda no terço superior da metade direita do mapa.
 * Os ratios 60% / 12% reproduzem a posição de referência do layout Maõno,
 * mas o resultado é limitado aos limites reais do canvas.
 */
export function calculateNativeLegendPlacement(
  mapRect: OverlayRect,
  legendRect: Pick<OverlayRect, "width" | "height">,
  offsetParentRect: Pick<OverlayRect, "left" | "top"> = {
    left: 0,
    top: 0,
  },
): NativeLegendPlacement {
  const desiredViewportLeft =
    mapRect.left + mapRect.width * MAONO_LEGEND_HORIZONTAL_RATIO;
  const desiredViewportTop =
    mapRect.top + mapRect.height * MAONO_LEGEND_VERTICAL_RATIO;
  const minimumViewportLeft = mapRect.left + MAONO_LEGEND_EDGE_MARGIN;
  const maximumViewportLeft =
    mapRect.left +
    mapRect.width -
    Math.max(0, legendRect.width) -
    MAONO_LEGEND_EDGE_MARGIN;
  const minimumViewportTop = mapRect.top + MAONO_LEGEND_EDGE_MARGIN;
  const maximumViewportTop =
    mapRect.top +
    mapRect.height -
    Math.max(0, legendRect.height) -
    MAONO_LEGEND_EDGE_MARGIN;

  return {
    left:
      clamp(
        desiredViewportLeft,
        minimumViewportLeft,
        maximumViewportLeft,
      ) - offsetParentRect.left,
    top:
      clamp(
        desiredViewportTop,
        minimumViewportTop,
        maximumViewportTop,
      ) - offsetParentRect.top,
  };
}
