import { beforeEach, describe, expect, it } from 'vitest';
import {
  testPrisma,
  resetDatabase,
  createTestUser,
  createTestOnCallSchedule,
} from '../helpers/test-db';
import { pagingDutiesOf } from '@/lib/users/stakeholder-role-guard';
import { administerUser } from '@/lib/users/administration';

describe('changing someone to Stakeholder', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('is blocked while they are on call or an escalation target, with the reasons', async () => {
    const admin = await createTestUser({ role: 'ADMIN' });
    const onCall = await createTestUser({ role: 'RESPONDER' });
    const stepped = await createTestUser({ role: 'RESPONDER' });
    const free = await createTestUser({ role: 'RESPONDER' });
    const schedule = await createTestOnCallSchedule('Primary', [{ userIds: [onCall.id] }]);
    await testPrisma.escalationPolicy.create({
      data: {
        name: 'Default',
        steps: { create: [{ stepOrder: 0, targetType: 'USER', targetUserId: stepped.id }] },
      },
    });

    const duties = await pagingDutiesOf([onCall.id, stepped.id, free.id]);
    expect(duties.get(onCall.id)).toEqual([`on call in "${schedule.name}"`]);
    expect(duties.get(stepped.id)).toEqual(['named in an escalation step of "Default"']);
    expect(duties.has(free.id)).toBe(false);

    await expect(
      administerUser(onCall.id, { operation: 'set-role', role: 'STAKEHOLDER' }, admin)
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      userMessage: expect.stringContaining('remove them from schedules'),
    });
    expect((await testPrisma.user.findUniqueOrThrow({ where: { id: onCall.id } })).role).toBe(
      'RESPONDER'
    );
    // Other roles and people without duties are unaffected.
    await administerUser(onCall.id, { operation: 'set-role', role: 'USER' }, admin);
    await administerUser(free.id, { operation: 'set-role', role: 'STAKEHOLDER' }, admin);
    expect((await testPrisma.user.findUniqueOrThrow({ where: { id: free.id } })).role).toBe(
      'STAKEHOLDER'
    );
  });

  it('ignores layers that have ended', async () => {
    const user = await createTestUser();
    await createTestOnCallSchedule('Old', [{ userIds: [user.id] }]);
    await testPrisma.onCallLayer.updateMany({ data: { end: new Date(Date.now() - 1000) } });
    expect((await pagingDutiesOf([user.id])).size).toBe(0);
  });
});
