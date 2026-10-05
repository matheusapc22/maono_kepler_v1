import type { RoadmapFilters } from "./roadmap-types";

export const ROADMAP_PAGE_SIZES = [10, 25, 50] as const;
export type RoadmapPaginationState = { queryKey: string; pageIndex: number; pageSize: number };

export function roadmapPaginationKey(organizationId: number | string | null | undefined, roadmapId: number | null, filters: RoadmapFilters) {
  return JSON.stringify([String(organizationId ?? ""), roadmapId, ...Object.keys(filters).sort().map(key => [key, filters[key as keyof RoadmapFilters]])]);
}

function normalizedPageSize(value: number) {
  return ROADMAP_PAGE_SIZES.find(size => size === value) ?? 10;
}

/** Only projects visible rows. The original bundle remains authoritative for metrics and timeline context. */
export function paginateRoadmapTasks<T>(tasks: readonly T[], pageIndex: number, pageSize: number) {
  const size = normalizedPageSize(pageSize);
  const total = tasks.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const index = Math.min(totalPages - 1, Math.max(0, Number.isFinite(pageIndex) ? Math.floor(pageIndex) : 0));
  return {
    tasks: tasks.slice(index * size, (index + 1) * size), total, totalPages,
    pageIndex: index, pageSize: size, canGoPrevious: index > 0, canGoNext: index < totalPages - 1,
  };
}

/** Reset query changes immediately, and retain a clamped page after the result set shrinks. */
export function reconcileRoadmapPagination(current: RoadmapPaginationState, queryKey: string, total: number): RoadmapPaginationState {
  const pageSize = normalizedPageSize(current.pageSize);
  const maxIndex = Math.max(0, Math.ceil(Math.max(0, total) / pageSize) - 1);
  const requestedIndex = Number.isFinite(current.pageIndex) ? Math.floor(current.pageIndex) : 0;
  const pageIndex = current.queryKey === queryKey ? Math.min(maxIndex, Math.max(0, requestedIndex)) : 0;
  return current.queryKey === queryKey && current.pageIndex === pageIndex && current.pageSize === pageSize ? current : { queryKey, pageIndex, pageSize };
}
