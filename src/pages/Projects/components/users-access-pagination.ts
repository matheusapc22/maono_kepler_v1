export const USERS_PAGE_SIZES = [10, 25, 50] as const;
export type UsersPaginationState = { queryKey: string; pageIndex: number; pageSize: number };
const normalizedSize = (value: number) => USERS_PAGE_SIZES.find(size => size === value) ?? 10;

/** The users endpoint returns the entire authorized organization roster. Slice
 * only after its existing local filters; never change the source of metrics. */
export function paginateUsers<T>(people: readonly T[], pageIndex: number, pageSize: number) {
  const size = normalizedSize(pageSize);
  const total = people.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const index = Math.min(totalPages - 1, Math.max(0, Number.isFinite(pageIndex) ? Math.floor(pageIndex) : 0));
  return {
    people: people.slice(index * size, (index + 1) * size), total, totalPages,
    pageIndex: index, pageSize: size, canGoPrevious: index > 0, canGoNext: index < totalPages - 1,
  };
}

/** A filter/organization change immediately resets; refreshed data clamps. */
export function reconcileUsersPagination(current: UsersPaginationState, queryKey: string, total: number): UsersPaginationState {
  const pageSize = normalizedSize(current.pageSize);
  const maxIndex = Math.max(0, Math.ceil(Math.max(0, total) / pageSize) - 1);
  const requestedIndex = Number.isFinite(current.pageIndex) ? Math.floor(current.pageIndex) : 0;
  const pageIndex = current.queryKey === queryKey ? Math.min(maxIndex, Math.max(0, requestedIndex)) : 0;
  return current.queryKey === queryKey && current.pageIndex === pageIndex && current.pageSize === pageSize ? current : { queryKey, pageIndex, pageSize };
}
