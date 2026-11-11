import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  prefetchStatement,
  type PrePagingLookupPlan,
} from '@/lib/intelligence/noise-controls/cache';

/** The statement as it was composed per event before the text was cached: the reference. */
function composed(plan: PrePagingLookupPlan): Prisma.Sql {
  const none = Prisma.sql`NULL`;
  const dedup = plan.dedup
    ? Prisma.sql`(SELECT json_build_object('id', i."id", 'labels', f."labels") FROM "Alert" a
        JOIN "Incident" i ON i."id" = a."incidentId"
        LEFT JOIN "IncidentFingerprint" f ON f."incidentId" = i."id"
        WHERE a."serviceId" = ${plan.serviceId} AND a."fingerprintHash" = ${plan.dedup.fingerprintHash}
          AND a."createdAt" >= ${plan.dedup.since}
          AND i."status" IN ('OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED')
        ORDER BY a."createdAt" DESC LIMIT 1)`
    : none;
  const statuses = plan.flapping
    ? Prisma.sql`(SELECT coalesce(json_agg(s."status" ORDER BY s."createdAt" DESC), '[]'::json) FROM (
        SELECT "status", "createdAt" FROM "Alert"
        WHERE "serviceId" = ${plan.serviceId} AND "createdAt" >= ${plan.flapping.since}
          AND ("dedupKey" = ${plan.flapping.dedupKey} OR (${plan.flapping.fingerprintHash}::text IS NOT NULL AND "fingerprintHash" = ${plan.flapping.fingerprintHash}))
        ORDER BY "createdAt" DESC LIMIT ${plan.flapping.limit}) s)`
    : none;
  const stormCount = plan.storm
    ? Prisma.sql`(SELECT count(*) FROM "Incident"
        WHERE "serviceId" = ANY(${[...plan.storm.serviceIds]}::text[]) AND "createdAt" >= ${plan.storm.since})`
    : none;
  const stormParent = plan.storm
    ? Prisma.sql`(SELECT "id" FROM "Incident"
        WHERE "serviceId" = ANY(${[...plan.storm.serviceIds]}::text[]) AND "createdAt" >= ${plan.storm.since}
          AND "status" IN ('OPEN', 'ACKNOWLEDGED')
        ORDER BY "createdAt" ASC, "id" ASC LIMIT 1)`
    : none;
  return Prisma.sql`SELECT ${dedup} AS "dedup", ${statuses} AS "statuses",
          ${stormCount} AS "stormCount", ${stormParent} AS "stormParent"`;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

function plan(
  dedup: boolean,
  flapping: boolean,
  storm: boolean,
  salt: string
): PrePagingLookupPlan {
  return {
    serviceId: `svc-${salt}`,
    dedup: dedup ? { fingerprintHash: `fp-${salt}`, since: new Date(1_700_000_000_000) } : null,
    flapping: flapping
      ? {
          dedupKey: `key-${salt}`,
          fingerprintHash: salt === 'a' ? `fp-${salt}` : null,
          since: new Date(1_700_000_100_000),
          limit: 20,
        }
      : null,
    storm: storm
      ? { serviceIds: [`svc-${salt}`, 'svc-neighbour'], since: new Date(1_700_000_200_000) }
      : null,
  };
}

describe('pre-paging combined lookup statement', () => {
  const shapes = [0, 1, 2, 3, 4, 5, 6, 7].map(bits => [!!(bits & 1), !!(bits & 2), !!(bits & 4)]);

  it.each(shapes)(
    'is the composed statement, text and parameters (dedup=%s flapping=%s storm=%s)',
    (dedup, flapping, storm) => {
      for (const salt of ['a', 'b']) {
        const input = plan(dedup, flapping, storm, salt);
        const actual = prefetchStatement(input);
        const expected = composed(input);
        expect(squash(actual.sql)).toBe(squash(expected.sql));
        expect(squash(actual.text)).toBe(squash(expected.text));
        expect(actual.values).toEqual(expected.values);
      }
    }
  );

  it('keeps one event out of another: values are never shared between statements', () => {
    const first = prefetchStatement(plan(true, true, true, 'a'));
    const second = prefetchStatement(plan(true, true, true, 'b'));
    expect(first.values).toContain('svc-a');
    expect(first.values).not.toContain('svc-b');
    expect(second.values).toContain('svc-b');
    expect(second.values).not.toContain('svc-a');
    expect(first.sql).toBe(second.sql);
  });
});
