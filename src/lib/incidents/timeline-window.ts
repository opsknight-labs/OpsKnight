export const TIMELINE_PAGE = { events: 200, notes: 100, notifications: 50 } as const;

type Page = { rows: readonly { createdAt: Date }[]; take: number };

/**
 * The timeline merges tables that are each cut at their own page size. A table that filled its
 * page may hold older rows, so the merged view is only complete back to the newest of those
 * tables' oldest rows. Showing anything older would skip rows that surface later, out of order.
 */
export function timelineCompleteSince(pages: readonly Page[]): Date | null {
  let since: Date | null = null;
  for (const { rows, take } of pages) {
    if (rows.length < take) continue;
    const oldest = rows.reduce(
      (min, row) => (row.createdAt < min ? row.createdAt : min),
      rows[0].createdAt
    );
    if (!since || oldest > since) since = oldest;
  }
  return since;
}

export function keepSince<T extends { createdAt: Date }>(
  rows: readonly T[],
  since: Date | null
): T[] {
  return since ? rows.filter(row => row.createdAt >= since) : [...rows];
}
