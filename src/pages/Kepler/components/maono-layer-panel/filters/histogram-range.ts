import {
  histogramRatioToValue,
  histogramValueToRatio,
} from "../../../engine-adapter/histogram-strategies.ts";
import type { MapHistogramAxisScale } from "../../../engine-adapter/histogram-types.ts";

export type HistogramRange = [number, number];
export type HistogramDragMode = "minimum" | "maximum" | "window";

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampHistogramRange(range: HistogramRange, domain: HistogramRange): HistogramRange {
  const minimum = clamp(range[0], domain[0], domain[1]);
  return [minimum, clamp(range[1], minimum, domain[1])];
}

function rangeStep(step: number, domain: HistogramRange) {
  return Number.isFinite(step) && step > 0 ? step : (domain[1] - domain[0]) / 1000 || 1;
}

function valueAtRatio(ratio: number, domain: HistogramRange, scale: MapHistogramAxisScale) {
  // Return exact endpoints, including when expm1(log1p(span)) rounds past the domain.
  if (ratio <= 0) return domain[0];
  if (ratio >= 1) return domain[1];
  return clamp(histogramRatioToValue(ratio, domain, scale), domain[0], domain[1]);
}

/** Translate in display space: numeric amplitude is intentionally not fixed on log axes. */
export function translateHistogramRange(
  range: HistogramRange,
  ratioDelta: number,
  domain: HistogramRange,
  scale: MapHistogramAxisScale,
): HistogramRange {
  const safeRange = clampHistogramRange(range, domain);
  if (!Number.isFinite(ratioDelta) || ratioDelta === 0 || domain[0] === domain[1]) return safeRange;
  const minimum = histogramValueToRatio(safeRange[0], domain, scale);
  const maximum = histogramValueToRatio(safeRange[1], domain, scale);
  const delta = clamp(ratioDelta, -minimum, 1 - maximum);
  if (delta === 0) return safeRange;
  return [valueAtRatio(minimum + delta, domain, scale), valueAtRatio(maximum + delta, domain, scale)];
}

/** Handles resize independently; the band never snaps its endpoints separately. */
export function dragHistogramRange(
  range: HistogramRange,
  mode: HistogramDragMode,
  ratioDelta: number,
  domain: HistogramRange,
  scale: MapHistogramAxisScale,
  step: number,
): HistogramRange {
  const safeRange = clampHistogramRange(range, domain);
  if (mode === "window") return translateHistogramRange(safeRange, ratioDelta, domain, scale);
  if (!Number.isFinite(ratioDelta) || ratioDelta === 0) return safeRange;
  const index = mode === "minimum" ? 0 : 1;
  const ratio = histogramValueToRatio(safeRange[index], domain, scale) + ratioDelta;
  const value = valueAtRatio(ratio, domain, scale);
  const increment = rangeStep(step, domain);
  const snapped = ratio <= 0 || ratio >= 1
    ? value
    : clamp(domain[0] + Math.round((value - domain[0]) / increment) * increment, domain[0], domain[1]);
  return index === 0
    ? [Math.min(snapped, safeRange[1]), safeRange[1]]
    : [safeRange[0], Math.max(snapped, safeRange[0])];
}

export function keyboardHistogramRange(
  range: HistogramRange,
  mode: HistogramDragMode,
  key: string,
  domain: HistogramRange,
  scale: MapHistogramAxisScale,
  step: number,
): HistogramRange | null {
  const direction = key === "ArrowLeft" || key === "ArrowDown" ? -1
    : key === "ArrowRight" || key === "ArrowUp" ? 1
    : key === "PageDown" ? -10 : key === "PageUp" ? 10 : 0;
  if (!direction && key !== "Home" && key !== "End") return null;
  const safeRange = clampHistogramRange(range, domain);
  if (mode === "window") {
    return translateHistogramRange(safeRange, key === "Home" ? -1 : key === "End" ? 1 : direction / 100, domain, scale);
  }
  const index = mode === "minimum" ? 0 : 1;
  const lower = index === 0 ? domain[0] : safeRange[0];
  const upper = index === 0 ? safeRange[1] : domain[1];
  const value = key === "Home" ? lower : key === "End" ? upper
    : clamp(safeRange[index] + direction * rangeStep(step, domain), lower, upper);
  return index === 0 ? [value, safeRange[1]] : [safeRange[0], value];
}
