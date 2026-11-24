import type { IncidentUrgency } from '@prisma/client';

/**
 * Most urgent first. `ORDER BY urgency` cannot give this order: schema.prisma declares LOW, MEDIUM, HIGH, but
 * MEDIUM was added to the database enum later (ALTER TYPE ... ADD VALUE), so a deployed database sorts
 * LOW, HIGH, MEDIUM and "descending" puts MEDIUM above HIGH.
 */
export const URGENCY_MOST_FIRST: readonly IncidentUrgency[] = ['HIGH', 'MEDIUM', 'LOW'];

/**
 * One page of rows ordered most urgent first, then by whatever order `fetch` applies inside a tier.
 * It queries one urgency at a time (at most three) and counts a tier only while skipping past it, so paging
 * ("show more") stays stable across tiers.
 */
export async function pageByUrgency<T>(options: {
  /** Rows of one urgency tier, already ordered by the caller (newest first, and so on). */
  fetch: (urgency: IncidentUrgency, skip: number, take: number) => Promise<T[]>;
  /** How many rows a tier holds; only called when `skip` reaches past earlier tiers. */
  count: (urgency: IncidentUrgency) => Promise<number>;
  skip?: number;
  take: number;
}): Promise<T[]> {
  let skip = options.skip ?? 0;
  const rows: T[] = [];
  for (const urgency of URGENCY_MOST_FIRST) {
    if (rows.length >= options.take) break;
    if (skip > 0) {
      const inTier = await options.count(urgency);
      if (skip >= inTier) {
        skip -= inTier;
        continue;
      }
    }
    rows.push(...(await options.fetch(urgency, skip, options.take - rows.length)));
    skip = 0;
  }
  return rows;
}
