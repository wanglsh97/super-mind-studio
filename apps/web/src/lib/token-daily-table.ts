export function paginateTokenDailyUsage<T extends { date: string }>(
  rows: readonly T[],
  requestedPage: number,
  pageSize = 10,
): { rows: T[]; page: number; totalPages: number } {
  const sorted = [...rows].sort((left, right) => right.date.localeCompare(left.date))
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const page = Math.min(totalPages, Math.max(1, Math.trunc(requestedPage)))
  const start = (page - 1) * pageSize
  return { rows: sorted.slice(start, start + pageSize), page, totalPages }
}
