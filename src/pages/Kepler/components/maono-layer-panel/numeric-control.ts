/** An empty or unfinished input is an editing draft, never the number zero. */
export function parseNumericDraft(text: string): number | null {
  if (!text.trim()) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function clampNumericValue(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function decimalPlaces(value: number) {
  const [coefficient, exponent = "0"] = String(value).split("e");
  return Math.max(0, (coefficient.split(".")[1]?.length ?? 0) - Number(exponent));
}

export function stepNumericValue(
  value: number,
  direction: -1 | 1,
  step: number,
  minimum: number,
  maximum: number,
) {
  const next = clampNumericValue(value + direction * step, minimum, maximum);
  const precision = Math.min(100, Math.max(
    decimalPlaces(value), decimalPlaces(step), decimalPlaces(minimum), decimalPlaces(maximum),
  ));
  return clampNumericValue(Number(next.toFixed(precision)), minimum, maximum);
}

/** Native ranges otherwise silently round an exact saved/manual decimal. */
export function numericRangeStep(value: number, minimum: number, step: number) {
  const increments = (value - minimum) / step;
  return Math.abs(increments - Math.round(increments)) < 1e-8 ? step : "any";
}

export function snapNumericSliderValue(value: number, minimum: number, maximum: number, step: number) {
  const bounded = clampNumericValue(value, minimum, maximum);
  const snapped = minimum + Math.round((bounded - minimum) / step) * step;
  const precision = Math.min(100, Math.max(decimalPlaces(minimum), decimalPlaces(step)));
  return clampNumericValue(Number(snapped.toFixed(precision)), minimum, maximum);
}

export function normalizeNumericDraft(
  text: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = parseNumericDraft(text);
  return clampNumericValue(
    parsed ?? (Number.isFinite(fallback) ? fallback : minimum),
    minimum,
    maximum,
  );
}

/** Avoid floating-point artifacts such as 28.999999999999996 percent. */
export function opacityToPercent(value: number) {
  return Number((value * 100).toFixed(12));
}

export function percentToOpacity(value: number) {
  return value / 100;
}
