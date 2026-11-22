import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { escalationTargetExists } from '@/lib/escalation/policy-validation';
import { resolveEscalationTargetDetailed } from '@/lib/escalation/target-resolution';
import { addScheduleLayerUser, createScheduleOverrideMutation } from '@/lib/schedules/mutations';
import { createTestTeam, createTestUser, resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

describeIfRealDB('stakeholders are never pageable (real database)', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('rejects a stakeholder as an escalation USER target', async () => {
    const stakeholder = await createTestUser({ name: 'Sam Stakeholder', role: 'STAKEHOLDER' });
    const responder = await createTestUser({ name: 'Rae Responder', role: 'RESPONDER' });

    await expect(escalationTargetExists(testPrisma, 'USER', responder.id)).resolves.toBe(true);
    await expect(escalationTargetExists(testPrisma, 'USER', stakeholder.id)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
    await expect(
      resolveEscalationTargetDetailed({ targetType: 'USER', targetId: stakeholder.id })
    ).resolves.toMatchObject({ outcome: 'INVALID_TARGET', code: 'TARGET_INVALID' });
  });

  it('skips stakeholders when a team is the escalation target', async () => {
    const team = await createTestTeam('Payments');
    const [stakeholder, responder] = await Promise.all([
      createTestUser({ name: 'Sam Stakeholder', role: 'STAKEHOLDER' }),
      createTestUser({ name: 'Uma User', role: 'USER' }),
    ]);
    await testPrisma.teamMember.createMany({
      data: [
        { teamId: team.id, userId: stakeholder.id, receiveTeamNotifications: true },
        { teamId: team.id, userId: responder.id, receiveTeamNotifications: true },
      ],
    });

    await expect(
      resolveEscalationTargetDetailed({ targetType: 'TEAM', targetId: team.id })
    ).resolves.toMatchObject({ outcome: 'RESOLVED', userIds: [responder.id] });
  });

  it('rejects a stakeholder joining an on-call layer or taking an override', async () => {
    const stakeholder = await createTestUser({ name: 'Sam Stakeholder', role: 'STAKEHOLDER' });
    const schedule = await testPrisma.onCallSchedule.create({
      data: {
        name: 'Stakeholder schedule',
        timeZone: 'UTC',
        layers: {
          create: [
            {
              name: 'Primary',
              start: new Date('2026-08-28T00:00:00.000Z'),
              rotationLengthHours: 24,
            },
          ],
        },
      },
      include: { layers: true },
    });

    await expect(addScheduleLayerUser(schedule.layers[0].id, stakeholder.id)).rejects.toMatchObject(
      { code: 'VALIDATION_FAILED' }
    );
    await expect(
      createScheduleOverrideMutation({
        scheduleId: schedule.id,
        userId: stakeholder.id,
        replacesUserId: null,
        start: new Date('2026-08-29T00:00:00.000Z'),
        end: new Date('2026-08-29T12:00:00.000Z'),
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

    expect(await testPrisma.onCallLayerUser.count()).toBe(0);
    expect(await testPrisma.onCallOverride.count()).toBe(0);
  });
});
