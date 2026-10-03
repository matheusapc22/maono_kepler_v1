type HintAnchor = { top: number; right: number; bottom: number };
type HintSize = { width: number; height: number };
type HintViewport = { width: number; height: number; left?: number; top?: number };

const MARGIN = 8;
const GAP = 6;

/** Fixed portal coordinates, including a mobile visual viewport's offset. */
export function panelHintPosition(
  anchor: HintAnchor,
  size: HintSize,
  viewport: HintViewport,
) {
  const originLeft = viewport.left ?? 0;
  const originTop = viewport.top ?? 0;
  const maxWidth = Math.max(0, viewport.width - MARGIN * 2);
  const maxHeight = Math.max(0, viewport.height - MARGIN * 2);
  const width = Math.min(size.width, maxWidth);
  const height = Math.min(size.height, maxHeight);
  const roomBelow = originTop + viewport.height - anchor.bottom - MARGIN;
  const roomAbove = anchor.top - originTop - MARGIN;
  const preferredTop = roomBelow < height + GAP && roomAbove > roomBelow
    ? anchor.top - height - GAP
    : anchor.bottom + GAP;

  return {
    left: Math.max(originLeft + MARGIN, Math.min(
      originLeft + viewport.width - width - MARGIN,
      anchor.right - width,
    )),
    top: Math.max(originTop + MARGIN, Math.min(
      originTop + viewport.height - height - MARGIN,
      preferredTop,
    )),
    maxWidth,
    maxHeight,
  };
}
