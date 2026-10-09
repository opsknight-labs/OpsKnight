import { afterAll, beforeEach, expect, it } from 'vitest';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(resetDatabase, 30000);
afterAll(() => db.$disconnect());

it('isolates escalation deduplication from a large runnable queue, including generic plans', async () => {
  await db.$executeRaw`
    INSERT INTO "BackgroundJob" (id, type, status, "scheduledAt", payload, "updatedAt")
    SELECT 'lookup-fixture-' || n, 'ESCALATION'::"JobType", 'PENDING'::"JobStatus",
           NOW(), jsonb_build_object('logicalKey', 'ESCALATION:fixture:' || n || ':0'), NOW()
    FROM generate_series(1, 10000) n
  `;
  await db.$executeRaw`ANALYZE "BackgroundJob"`;
  expect(
    await db.backgroundJob.findFirst({
      where: {
        type: 'ESCALATION',
        status: { in: ['PENDING', 'PROCESSING'] },
        payload: { path: ['logicalKey'], equals: 'ESCALATION:fixture:5000:0' },
      },
      select: { id: true },
    })
  ).toEqual({ id: 'lookup-fixture-5000' });

  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET LOCAL plan_cache_mode = force_generic_plan');
    await tx.$executeRawUnsafe(`PREPARE escalation_lookup_test(jsonb, "JobType", "JobStatus", "JobStatus") AS
      SELECT id FROM "BackgroundJob"
      WHERE type = $2 AND status IN ($3, $4)
        AND payload #> ARRAY['logicalKey']::text[] = $1 LIMIT 1`);
    try {
      for (const key of ['ESCALATION:fixture:5000:0', 'ESCALATION:absent:0:0']) {
        // Keys are fixed fixture literals; EXECUTE does not accept bind parameters.
        const rows = await tx.$queryRawUnsafe<
          Array<{
            'QUERY PLAN': Array<{
              Plan: {
                'Shared Hit Blocks': number;
                'Shared Read Blocks': number;
                'Actual Rows': number;
              };
            }>;
          }>
        >(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
          EXECUTE escalation_lookup_test('"${key}"', 'ESCALATION', 'PENDING', 'PROCESSING')`);
        expect(JSON.stringify(rows)).toContain('BackgroundJob_escalation_logical_key_lookup_idx');
        const plan = rows[0]['QUERY PLAN'][0].Plan;
        expect(plan['Actual Rows']).toBe(key.includes('absent') ? 0 : 1);
        expect(plan['Shared Hit Blocks'] + plan['Shared Read Blocks']).toBeLessThan(32);
      }
    } finally {
      await tx.$executeRawUnsafe('DEALLOCATE escalation_lookup_test');
    }
  });
});
