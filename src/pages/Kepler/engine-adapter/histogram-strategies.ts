import type {
  MapFilterHistogramBin,
  MapHistogramAxisScale,
  MapHistogramStrategy,
} from "./types.ts";

const MIN_BINS = 6;
const MAX_BINS = 60;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function quantile(sorted: readonly number[], probability: number) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];

  const position = clamp(probability, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function normalizedDomain(
  values: readonly number[],
  requested: [number, number] | null,
): [number, number] | null {
  if (!values.length) return requested;

  const observed: [number, number] = [values[0], values[values.length - 1]];
  if (
    requested &&
    Number.isFinite(requested[0]) &&
    Number.isFinite(requested[1]) &&
    requested[1] > requested[0]
  ) {
    return requested;
  }
  if (observed[1] > observed[0]) return observed;
  return [observed[0] - 0.5, observed[1] + 0.5];
}

function sturgesBinCount(sampleSize: number) {
  return Math.ceil(Math.log2(Math.max(2, sampleSize)) + 1);
}

function allowedBinCount(value: number, sampleSize: number) {
  const maximum = Math.min(MAX_BINS, Math.max(1, sampleSize));
  const minimum = Math.min(MIN_BINS, maximum);
  return clamp(Math.round(value), minimum, maximum);
}

function shiftedLogTransform(value: number, minimum: number) {
  return Math.log1p(Math.max(0, value - minimum));
}

function shiftedLogInverse(value: number, minimum: number) {
  return minimum + Math.expm1(value);
}

export function histogramValueToRatio(
  value: number,
  domain: [number, number],
  scale: MapHistogramAxisScale,
) {
  const [minimum, maximum] = domain;
  if (maximum <= minimum) return 0;

  if (scale === "log-shifted") {
    const transformedMinimum = 0;
    const transformedMaximum = shiftedLogTransform(maximum, minimum);
    const transformed = shiftedLogTransform(clamp(value, minimum, maximum), minimum);
    return transformedMaximum <= transformedMinimum
      ? 0
      : (transformed - transformedMinimum) /
          (transformedMaximum - transformedMinimum);
  }

  return (clamp(value, minimum, maximum) - minimum) / (maximum - minimum);
}

export function histogramRatioToValue(
  ratio: number,
  domain: [number, number],
  scale: MapHistogramAxisScale,
) {
  const normalized = clamp(ratio, 0, 1);
  const [minimum, maximum] = domain;

  if (scale === "log-shifted") {
    const transformedMaximum = shiftedLogTransform(maximum, minimum);
    return shiftedLogInverse(normalized * transformedMaximum, minimum);
  }

  return minimum + normalized * (maximum - minimum);
}

function chooseNumericScale(
  sorted: readonly number[],
  domain: [number, number],
): MapHistogramAxisScale {
  if (sorted.length < 12) return "linear";

  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const span = domain[1] - domain[0];
  const median = quantile(sorted, 0.5);
  const robustScale = Math.max(iqr, Math.abs(median) * 0.02, 1e-12);

  return span / robustScale >= 40 ? "log-shifted" : "linear";
}

function transformedValues(
  sorted: readonly number[],
  domain: [number, number],
  scale: MapHistogramAxisScale,
) {
  if (scale === "log-shifted") {
    return sorted.map((value) => shiftedLogTransform(value, domain[0]));
  }
  return Array.from(sorted);
}

function numericBinCount(
  transformed: readonly number[],
): { count: number; strategy: MapHistogramStrategy } {
  if (transformed.length <= 1) return { count: 1, strategy: "sturges" };
  if (transformed.length < 30) {
    return {
      count: allowedBinCount(sturgesBinCount(transformed.length), transformed.length),
      strategy: "sturges",
    };
  }

  const sorted = Array.from(transformed).sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const span = sorted[sorted.length - 1] - sorted[0];
  const width = 2 * iqr * Math.pow(sorted.length, -1 / 3);

  if (Number.isFinite(width) && width > 0 && span > 0) {
    return {
      count: allowedBinCount(Math.ceil(span / width), sorted.length),
      strategy: "freedman-diaconis",
    };
  }

  return {
    count: allowedBinCount(Math.ceil(Math.sqrt(sorted.length)), sorted.length),
    strategy: "sqrt",
  };
}

function buildUniformBins(
  values: readonly number[],
  domain: [number, number],
  count: number,
  scale: MapHistogramAxisScale,
): MapFilterHistogramBin[] {
  const safeCount = Math.max(1, count);
  const bins = Array.from({ length: safeCount }, () => 0);
  const [minimum, maximum] = domain;

  for (const value of values) {
    if (value < minimum || value > maximum) continue;
    const ratio = histogramValueToRatio(value, domain, scale);
    const index = Math.min(safeCount - 1, Math.max(0, Math.floor(ratio * safeCount)));
    bins[index] += 1;
  }

  return bins.map((countValue, index) => {
    const start = histogramRatioToValue(index / safeCount, domain, scale);
    const end = histogramRatioToValue((index + 1) / safeCount, domain, scale);
    return { start, end, count: countValue };
  });
}

const TIME_INTERVALS = [
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
  7 * 24 * 60 * 60_000,
  30 * 24 * 60 * 60_000,
  90 * 24 * 60 * 60_000,
  365.25 * 24 * 60 * 60_000,
];

function temporalBinCount(domain: [number, number]) {
  const span = domain[1] - domain[0];
  const interval =
    TIME_INTERVALS.find((candidate) => span / candidate <= 36) ??
    TIME_INTERVALS[TIME_INTERVALS.length - 1];
  return allowedBinCount(Math.ceil(span / interval), 60);
}

export type HistogramBuildResult = {
  bins: MapFilterHistogramBin[];
  displayDomain: [number, number] | null;
  observedDomain: [number, number] | null;
  axisScale: MapHistogramAxisScale;
  strategy: MapHistogramStrategy;
};

export function buildAdaptiveHistogram(
  rawValues: readonly number[],
  requestedDomain: [number, number] | null,
  temporal: boolean,
): HistogramBuildResult {
  const values = rawValues.filter(Number.isFinite).sort((a, b) => a - b);
  if (!values.length) {
    return {
      bins: [],
      displayDomain: requestedDomain,
      observedDomain: null,
      axisScale: temporal ? "time" : "linear",
      strategy: temporal ? "calendar" : "sturges",
    };
  }

  const observedDomain: [number, number] = [values[0], values[values.length - 1]];
  const displayDomain = normalizedDomain(values, requestedDomain);
  if (!displayDomain) {
    return {
      bins: [],
      displayDomain: null,
      observedDomain,
      axisScale: temporal ? "time" : "linear",
      strategy: temporal ? "calendar" : "sturges",
    };
  }

  if (temporal) {
    return {
      bins: buildUniformBins(
        values,
        displayDomain,
        temporalBinCount(displayDomain),
        "time",
      ),
      displayDomain,
      observedDomain,
      axisScale: "time",
      strategy: "calendar",
    };
  }

  if (observedDomain[0] === observedDomain[1]) {
    return {
      bins: [{ start: observedDomain[0], end: observedDomain[1], count: values.length }],
      displayDomain,
      observedDomain,
      axisScale: "linear",
      strategy: "sturges",
    };
  }

  const axisScale = chooseNumericScale(values, displayDomain);
  const transformed = transformedValues(values, displayDomain, axisScale);
  const { count, strategy } = numericBinCount(transformed);

  return {
    bins: buildUniformBins(values, displayDomain, count, axisScale),
    displayDomain,
    observedDomain,
    axisScale,
    strategy,
  };
}
