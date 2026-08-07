import type { MapFilterHistogramBin } from "./types.ts";

export type MapHistogramAxisScale = "linear" | "log-shifted" | "time";

export type MapHistogramStrategy =
  | "freedman-diaconis"
  | "sturges"
  | "sqrt"
  | "calendar"
  | "native";

export type MapHistogramQuality = "exact" | "sampled" | "fallback";
export type MapHistogramSource = "smart" | "kepler-native" | "empty";

export type MapSmartHistogram = {
  bins: MapFilterHistogramBin[];
  originalDomain: [number, number] | null;
  displayDomain: [number, number] | null;
  observedDomain: [number, number] | null;
  observedCount: number;
  scannedRowCount: number;
  sampleSize: number | null;
  strategy: MapHistogramStrategy;
  quality: MapHistogramQuality;
  source: MapHistogramSource;
  axisScale: MapHistogramAxisScale;
  fallbackReason: string | null;
};
