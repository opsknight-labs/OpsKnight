import { beforeEach, describe, expect, it } from 'vitest';
import { declareDependency, reviewDependency } from '@/lib/intelligence/dependencies/service';
import {
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

async function setup() {
  const user = await createTestUser({ role: 'ADMIN' });
  const actor = { actorId: user.id, source: 'UI' as const };
  const a = await createTestService('A');
  const b = await createTestService('B');
  return { actor, a, b };
}

describe('dependency cycle checks (P4)', () => {
  it('refuses to approve a suggested edge that closes a cycle', async () => {
    const { actor, a, b } = await setup();
    await declareDependency({ upstreamServiceId: a.id, downstreamServiceId: b.id }, actor);
    const suggested = await db.serviceDependency.create({
      data: {
        upstreamServiceId: b.id,
        downstreamServiceId: a.id,
        origin: 'OBSERVED',
        status: 'SUGGESTED',
        confidence: 0.5,
        evidence: {},
      },
    });
    await expect(reviewDependency(suggested.id, 'APPROVE', actor)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    expect(
      (await db.serviceDependency.findUniqueOrThrow({ where: { id: suggested.id } })).status
    ).toBe('SUGGESTED');
    // Rejecting is always allowed.
    await expect(reviewDependency(suggested.id, 'REJECT', actor)).resolves.toBe('updated');
  });

  it('serializes concurrent opposite declarations so only one edge lands', async () => {
    const { actor, a, b } = await setup();
    const results = await Promise.allSettled([
      declareDependency({ upstreamServiceId: a.id, downstreamServiceId: b.id }, actor),
      declareDependency({ upstreamServiceId: b.id, downstreamServiceId: a.id }, actor),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await db.serviceDependency.count({ where: { status: 'ACTIVE' } })).toBe(1);
  });
});
