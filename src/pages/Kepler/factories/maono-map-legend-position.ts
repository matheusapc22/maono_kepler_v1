export type MaonoLegendCanvasSize = {
  width?: number | null;
  height?: number | null;
};

export type MaonoLegendPanelSize = {
  width: number;
  height: number;
};

export type MaonoLegendPosition = {
  x: number;
  y: number;
  anchorX: "right";
  anchorY: "top";
};

export const MAONO_LEGEND_HORIZONTAL_RATIO = 0.63;
export const MAONO_LEGEND_VERTICAL_RATIO = 0.12;
export const MAONO_LEGEND_EDGE_MARGIN = 16;
export const MAONO_LEGEND_DEFAULT_WIDTH = 300;
export const MAONO_LEGEND_MIN_HEIGHT = 132;

const DEFAULT_PANEL_SIZE: MaonoLegendPanelSize = {
  width: MAONO_LEGEND_DEFAULT_WIDTH,
  height: MAONO_LEGEND_MIN_HEIGHT,
};

function finiteDimension(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function clamp(value: number, minimum: number, maximum: number) {
  if (maximum <= minimum) return minimum;
  return Math.min(maximum, Math.max(minimum, value));
}

/**
 * Calcula a posição inicial da legenda somente a partir do estado de viewport
 * que o Kepler entrega ao componente React. Não mede canvas nem legenda via DOM.
 *
 * A borda esquerda nasce em 63% do canvas no eixo X e 12% no eixo Y. O valor
 * final é convertido para uma âncora `right`, mantendo exatamente a mesma
 * posição visual. Isso evita o efeito nativo do Kepler que reposiciona âncoras
 * `left` quando o painel lateral abre/fecha e, portanto, evita uma gravação de
 * settings durante a própria abertura da legenda.
 */
export function calculateMaonoLegendInitialPosition(
  canvas: MaonoLegendCanvasSize,
  panel: Partial<MaonoLegendPanelSize> = DEFAULT_PANEL_SIZE,
): MaonoLegendPosition | null {
  const width = finiteDimension(canvas?.width);
  const height = finiteDimension(canvas?.height);
  if (!width || !height) return null;

  const panelWidth = finiteDimension(panel.width) || DEFAULT_PANEL_SIZE.width;
  const panelHeight = finiteDimension(panel.height) || DEFAULT_PANEL_SIZE.height;
  const desiredLeft = width * MAONO_LEGEND_HORIZONTAL_RATIO;
  const desiredY = height * MAONO_LEGEND_VERTICAL_RATIO;
  const maximumLeft = width - panelWidth - MAONO_LEGEND_EDGE_MARGIN;
  const maximumY = height - panelHeight - MAONO_LEGEND_EDGE_MARGIN;
  const left = clamp(desiredLeft, MAONO_LEGEND_EDGE_MARGIN, maximumLeft);
  const right = Math.max(
    MAONO_LEGEND_EDGE_MARGIN,
    width - left - panelWidth,
  );

  return {
    x: right,
    y: clamp(desiredY, MAONO_LEGEND_EDGE_MARGIN, maximumY),
    anchorX: "right",
    anchorY: "top",
  };
}
