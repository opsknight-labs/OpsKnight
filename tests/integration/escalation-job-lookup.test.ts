import { afterAll, beforeEach, expect, it } from 'vitest';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';
import { escalationJobLookupQuery } from '@/lib/escalation/job-query';

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
  expect(await db.$queryRaw(escalationJobLookupQuery('ESCALATION:fixture:5000:0'))).toEqual([
    { id: 'lookup-fixture-5000' },
  ]);

  await db.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET LOCAL plan_cache_mode = force_generic_plan');
    // Prepare the production statement, including its exact parameter positions.
    const query = escalationJobLookupQuery('ESCALATION:fixture:5000:0');
    await tx.$executeRawUnsafe(`PREPARE escalation_lookup_test(text) AS ${query.text}`);
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
          EXECUTE escalation_lookup_test('"${key}"')`);
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
