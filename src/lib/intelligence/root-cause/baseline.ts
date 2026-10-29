import 'server-only';
import { Prisma } from '@prisma/client';

const DAY = 86_400_000;
export const CHANGE_BASELINE_DAYS = 30;
type Baseline = { count: number; factor: number };
const cache = new Map<string, { at: number; values: Map<string, Baseline> }>();
const identity = (source: string, serviceId: string | null) => JSON.stringify([source, serviceId]);

/** Poisson chance of a source producing a change in any six-hour window, independent of an incident. */
export function changeChanceFactor(
  count: number,
  exposureHours = CHANGE_BASELINE_DAYS * 24 - 6
): number {
  return 0.1 + 0.9 * Math.exp((-Math.max(0, count) * 6) / Math.max(1, exposureHours));
}

export async function loadChangeBaselines(
  tx: Prisma.TransactionClient,
  serviceIds: readonly string[],
  onset: Date
) {
  const key = JSON.stringify([[...serviceIds].sort(), Math.floor(+onset / 3_600_000)]);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000)
    return (source: string, serviceId: string | null) =>
      hit.values.get(identity(source, serviceId)) ?? { count: 0, factor: 1 };
  const rows = await tx.$queryRaw<
    Array<{ source: string; serviceId: string | null; count: number }>
  >(Prisma.sql`
    SELECT "source", "serviceId", count(*)::int AS count FROM "ChangeEvent"
    WHERE "occurredAt" >= ${new Date(+onset - CHANGE_BASELINE_DAYS * DAY)}
      AND "occurredAt" < ${new Date(+onset - 6 * 3_600_000)}
      AND ("serviceId" = ANY(${[...serviceIds]}) OR "serviceId" IS NULL)
    GROUP BY "source", "serviceId"`);
  const values = new Map(
    rows.map(row => [
      identity(row.source, row.serviceId),
      { count: row.count, factor: changeChanceFactor(row.count) },
    ])
  );
  if (cache.size >= 100) cache.clear();
  cache.set(key, { at: Date.now(), values });
  return (source: string, serviceId: string | null) =>
    values.get(identity(source, serviceId)) ?? { count: 0, factor: 1 };
}
