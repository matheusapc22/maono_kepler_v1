/** Presentation only: these states never start, delay, or settle a request. */
export type RegionLoadingState =
  | "initial"
  | "refreshing"
  | "ready"
  | "empty"
  | "error"
  | "cancelled";

export function resolveRegionState({
  loading,
  hasData,
  error,
  cancelled = false,
}: {
  loading: boolean;
  /** Only data valid for the current access context may be counted here. */
  hasData: boolean;
  error?: unknown;
  cancelled?: boolean;
}): RegionLoadingState {
  if (cancelled) return "cancelled";
  if (error) return "error";
  if (loading) return hasData ? "refreshing" : "initial";
  return hasData ? "ready" : "empty";
}

export type SkeletonCountOptions = {
  layout?: "table" | "list" | "grid";
  pageSize?: number;
  /** Authoritative count for this region/page, not a count from an old query. */
  knownCount?: number;
  viewportHeight?: number;
  viewportWidth?: number;
  reservedHeight?: number;
  itemHeight?: number;
  columns?: number;
  maxCount?: number;
};

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/** A bounded visual estimate, never a reported number of results. */
export function estimateSkeletonCount({
  layout = "table",
  pageSize,
  knownCount,
  viewportHeight,
  viewportWidth,
  reservedHeight = 280,
  itemHeight,
  columns,
  maxCount,
}: SkeletonCountOptions = {}): number {
  const width = positive(viewportWidth, 1280);
  const height = positive(viewportHeight, 768);
  const columnCount = layout === "grid"
    ? Math.max(1, Math.floor(positive(columns, width < 768 ? 1 : width < 1280 ? 2 : 3)))
    : 1;
  const rowHeight = positive(itemHeight, layout === "grid" ? 360 : layout === "list" ? 72 : 48);
  const reserved = Number.isFinite(reservedHeight) ? Math.max(0, reservedHeight) : 280;
  const visibleRows = Math.max(1, Math.ceil(Math.max(rowHeight, height - reserved) / rowHeight));
  const cap = Math.max(1, Math.floor(positive(maxCount, layout === "grid" ? 9 : 12)));
  const pageCap = Math.max(1, Math.floor(positive(pageSize, cap)));
  const knownCap = knownCount !== undefined && Number.isFinite(knownCount) && knownCount >= 0
    ? Math.floor(knownCount)
    : cap;
  return Math.min(visibleRows * columnCount, cap, pageCap, knownCap);
}

export const DEFAULT_PROLONGED_LOADING_MS = 8_000;

/** A rejected access boundary invalidates previously revealed regional data. */
export function isRegionAccessDenied(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: unknown; category?: unknown; code?: unknown };
  return isRegionAuthenticationError(error) || Number(value.status) === 403 ||
    value.category === "PERMISSION" || value.category === "AUTH" || /^(AUTH|PERMISSION)_/.test(String(value.code ?? ""));
}

/** Authentication loss invalidates companion requests in the same access context. */
export function isRegionAuthenticationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const value = error as { status?: unknown; category?: unknown; code?: unknown };
  const status = Number(value.status);
  if (status === 403) return false;
  const code = String(value.code ?? "");
  return status === 401 || ["AUTH_SESSION_REQUIRED", "AUTH_SESSION_EXPIRED"].includes(code) ||
    (value.category === "AUTH" && code !== "AUTH_PERMISSION_DENIED");
}
