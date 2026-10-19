import { beforeEach, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { apiV2Error } from '@/lib/api-v2/response';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(resetDatabase);

it('serializes direct nested membership inserts while retaining every parent revision', async () => {
  const pool = await db.runbookAgentPool.create({ data: { name: 'Concurrent membership pool' } });
  const results = await Promise.allSettled(
    Array.from({ length: 50 }, (_, index) =>
      db.runbookAgent.create({
        data: {
          name: `Concurrent Agent ${index}`,
          poolMemberships: { create: { poolId: pool.id } },
        },
      })
    )
  );
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(0);
  expect(await db.runbookAgentPoolMember.count({ where: { poolId: pool.id } })).toBe(50);
  expect((await db.runbookAgentPool.findUniqueOrThrow({ where: { id: pool.id } })).revision).toBe(
    pool.revision + 50
  );
});

it('orders both parent locks when direct writers move memberships in opposite directions', async () => {
  const pools = await Promise.all(
    ['A', 'B'].map(name => db.runbookAgentPool.create({ data: { name } }))
  );
  const agents = await Promise.all(
    pools.map(pool =>
      db.runbookAgent.create({
        data: {
          name: pool.name,
          poolMemberships: { create: { poolId: pool.id } },
        },
        include: { poolMemberships: true },
      })
    )
  );
  const [a, b] = agents;
  const before = await db.runbookAgentPool.findMany({ orderBy: { name: 'asc' } });
  const results = await Promise.allSettled([
    db.runbookAgentPoolMember.update({
      where: { id: a.poolMemberships[0].id },
      data: { poolId: pools[1].id },
    }),
    db.runbookAgentPoolMember.update({
      where: { id: b.poolMemberships[0].id },
      data: { poolId: pools[0].id },
    }),
  ]);
  expect(results.filter(result => result.status === 'rejected')).toHaveLength(0);
  const after = await db.runbookAgentPool.findMany({ orderBy: { name: 'asc' } });
  expect(after.map(pool => pool.revision)).toEqual(before.map(pool => pool.revision + 2));
});

it('maps the actual nested-write Prisma error from a deliberately recreated shared-lock upgrade cycle', async () => {
  const pool = await db.runbookAgentPool.create({ data: { name: 'Error-shape reproduction' } });
  let arrived = 0;
  let release!: () => void;
  const ready = new Promise<void>(resolve => {
    release = resolve;
  });
  const results = await Promise.allSettled(
    [0, 1].map(index =>
      db.$transaction(
        async tx => {
          // Recreate the pre-fix lock state deliberately. Normal inserts now take
          // NO KEY UPDATE first and never accumulate these competing shared locks.
          await tx.$queryRaw`SELECT id FROM "RunbookAgentPool" WHERE id = ${pool.id} FOR SHARE`;
          if (++arrived === 2) release();
          await ready;
          await tx.runbookAgent.create({
            data: {
              name: `Error-shape Agent ${index}`,
              poolMemberships: { create: { poolId: pool.id } },
            },
          });
        },
        { timeout: 10000 }
      )
    )
  );
  const failed = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected'
  );
  expect(failed).toHaveLength(1);
  expect(failed[0].reason).toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
  const response = apiV2Error(
    failed[0].reason,
    new NextRequest('http://localhost/api/v2/runbooks/agents')
  );
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body).toMatchObject({ code: 'TRANSIENT_CONFLICT', retryable: true });
  expect(JSON.stringify(body)).not.toMatch(/ConnectorError|PostgresError|Process \d/);
});
