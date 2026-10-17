import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { testPrisma as db, resetDatabase, createTestUser } from '../helpers/test-db';
import { addPolicyStep, updatePolicy, createPolicyAction } from '@/app/(app)/policies/actions';
vi.mock('@/lib/rbac', () => ({ assertAdmin: vi.fn(async () => ({ id: 'test-admin' })) }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

describe('responder policy mutation snapshot invariants', () => {
  beforeEach(resetDatabase);
  afterAll(async () => {
    await db.$disconnect();
  });
  it('rejects step 51 and rolls back the entire mutation', async () => {
    const user = await createTestUser();
    const policy = await db.escalationPolicy.create({ data: { name: 'Bounded policy' } });
    await db.escalationRule.createMany({
      data: Array.from({ length: 50 }, (_, stepOrder) => ({
        policyId: policy.id,
        stepOrder,
        delayMinutes: 0,
        targetType: 'USER' as const,
        targetUserId: user.id,
        notificationChannels: [],
      })),
    });
    const form = new FormData();
    form.set('targetType', 'USER');
    form.set('targetUserId', user.id);
    form.set('delayMinutes', '0');
    expect(await addPolicyStep(policy.id, form)).toMatchObject({
      error: expect.stringContaining('maximum step limit'),
    });
    expect(await db.escalationRule.count({ where: { policyId: policy.id } })).toBe(50);
  });
  it('serializes concurrent additions so only one can occupy the last valid step', async () => {
    const user = await createTestUser();
    const policy = await db.escalationPolicy.create({
      data: { name: 'Concurrent bounded policy' },
    });
    await db.escalationRule.createMany({
      data: Array.from({ length: 49 }, (_, stepOrder) => ({
        policyId: policy.id,
        stepOrder,
        delayMinutes: 0,
        targetType: 'USER' as const,
        targetUserId: user.id,
        notificationChannels: [],
      })),
    });
    const form = new FormData();
    form.set('targetType', 'USER');
    form.set('targetUserId', user.id);
    form.set('delayMinutes', '0');
    const results = await Promise.all([
      addPolicyStep(policy.id, form),
      addPolicyStep(policy.id, form),
    ]);
    expect(results.filter(result => result?.error)).toHaveLength(1);
    expect(await db.escalationRule.count({ where: { policyId: policy.id } })).toBe(50);
  });
  it('rolls back an oversized rename and rejects oversized creation', async () => {
    const policy = await db.escalationPolicy.create({ data: { name: 'Safe name' } });
    const form = new FormData();
    form.set('name', 'x'.repeat(70000));
    await expect(updatePolicy(policy.id, form)).rejects.toThrow('byte size limit');
    expect((await db.escalationPolicy.findUniqueOrThrow({ where: { id: policy.id } })).name).toBe(
      'Safe name'
    );
    expect(await createPolicyAction({}, form)).toMatchObject({
      error: expect.stringContaining('byte size limit'),
    });
    expect(await db.escalationPolicy.count()).toBe(1);
  });
});
