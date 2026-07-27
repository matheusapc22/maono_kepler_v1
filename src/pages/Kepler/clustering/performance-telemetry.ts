export type PointClusterTelemetryEvent =
  | "mode_changed"
  | "cluster_clicked"
  | "pair_created"
  | "pair_failed";

function pointCountBucket(pointCount: number) {
  if (pointCount <= 10_000) return "up_to_10k";
  if (pointCount <= 100_000) return "10k_to_100k";
  if (pointCount <= 300_000) return "100k_to_300k";
  return "over_300k";
}

export function emitPointClusterTelemetry({
  event,
  pointCount,
  mode,
  durationMs,
}: {
  event: PointClusterTelemetryEvent;
  pointCount: number;
  mode?: "cluster" | "points";
  durationMs?: number;
}) {
  if (typeof window === "undefined") {
    return;
  }

  const detail = {
    event,
    pointCountBucket: pointCountBucket(pointCount),
    ...(mode ? { mode } : {}),
    ...(Number.isFinite(durationMs)
      ? { durationMs: Math.round(durationMs ?? 0) }
      : {}),
  };

  window.dispatchEvent(
    new CustomEvent("maono:point-clustering", {
      detail,
    }),
  );
}
