import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { addScheduleLayerUser, createScheduleOverrideMutation } from '@/lib/schedules/mutations';
import { isAppError } from '@/lib/errors';
import { createTestUser, resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

async function createScheduleWithTwoLayers() {
  return testPrisma.onCallSchedule.create({
    data: {
      name: `Schedule concurrency ${Math.random().toString(36).slice(2)}`,
      timeZone: 'UTC',
      layers: {
        create: [
          {
            name: 'Primary',
            start: new Date('2026-08-28T00:00:00.000Z'),
            rotationLengthHours: 24,
          },
          {
            name: 'Secondary',
            start: new Date('2026-08-28T00:00:00.000Z'),
            rotationLengthHours: 24,
          },
        ],
      },
    },
    include: { layers: { orderBy: { createdAt: 'asc' } } },
  });
}

function appErrorCodes(results: PromiseSettledResult<unknown>[]) {
  return results.flatMap(result => {
    if (result.status !== 'rejected' || !isAppError(result.reason)) return [];
    return [result.reason.code];
  });
}

describeIfRealDB('schedule mutation concurrency', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('serializes simultaneous attempts to assign one responder to different layers', async () => {
    const [schedule, responder] = await Promise.all([
      createScheduleWithTwoLayers(),
      createTestUser({ email: 'same-responder@example.com', name: 'Same Responder' }),
    ]);

    const results = await Promise.allSettled([
      addScheduleLayerUser(schedule.layers[0].id, responder.id),
      addScheduleLayerUser(schedule.layers[1].id, responder.id),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(appErrorCodes(results)).toEqual(['SCHEDULE_LAYER_USER_DUPLICATE']);

    const assignments = await testPrisma.onCallLayerUser.findMany({
      where: {
        userId: responder.id,
        layer: { scheduleId: schedule.id },
      },
    });
    expect(assignments).toHaveLength(1);
  });

  it('allocates unique contiguous positions for simultaneous additions to one layer', async () => {
    const [schedule, alex, taylor] = await Promise.all([
      createScheduleWithTwoLayers(),
      createTestUser({ email: 'alex-position@example.com', name: 'Alex Position' }),
      createTestUser({ email: 'taylor-position@example.com', name: 'Taylor Position' }),
    ]);

    await Promise.all([
      addScheduleLayerUser(schedule.layers[0].id, alex.id),
      addScheduleLayerUser(schedule.layers[0].id, taylor.id),
    ]);

    const assignments = await testPrisma.onCallLayerUser.findMany({
      where: { layerId: schedule.layers[0].id },
      orderBy: { position: 'asc' },
      select: { userId: true, position: true },
    });

    expect(assignments).toHaveLength(2);
    expect(assignments.map(entry => entry.position)).toEqual([1, 2]);
    expect(new Set(assignments.map(entry => entry.userId))).toEqual(new Set([alex.id, taylor.id]));
  });

  it('rejects inactive responders at the authoritative mutation boundary', async () => {
    const [schedule, disabled] = await Promise.all([
      createScheduleWithTwoLayers(),
      createTestUser({
        email: 'disabled-schedule@example.com',
        name: 'Disabled Responder',
        status: 'DISABLED',
      }),
    ]);

    await expect(addScheduleLayerUser(schedule.layers[0].id, disabled.id)).rejects.toMatchObject({
      code: 'SCHEDULE_RESPONDER_NOT_ACTIVE',
    });

    expect(await testPrisma.onCallLayerUser.count({ where: { userId: disabled.id } })).toBe(0);
  });

  it('rejects an inactive replacement responder before persisting an override', async () => {
    const [schedule, target, disabledReplacement] = await Promise.all([
      createScheduleWithTwoLayers(),
      createTestUser({ email: 'override-target@example.com', name: 'Override Target' }),
      createTestUser({
        email: 'override-disabled-replacement@example.com',
        name: 'Disabled Replacement',
        status: 'DISABLED',
      }),
    ]);

    await expect(
      createScheduleOverrideMutation({
        scheduleId: schedule.id,
        userId: target.id,
        replacesUserId: disabledReplacement.id,
        start: new Date('2026-08-29T00:00:00.000Z'),
        end: new Date('2026-08-29T12:00:00.000Z'),
      })
    ).rejects.toMatchObject({ code: 'SCHEDULE_RESPONDER_NOT_ACTIVE' });

    expect(await testPrisma.onCallOverride.count({ where: { scheduleId: schedule.id } })).toBe(0);
  });

  it('serializes overlapping replacement overrides so only one coverage owner is committed', async () => {
    const [schedule, replaced, alex, taylor] = await Promise.all([
      createScheduleWithTwoLayers(),
      createTestUser({ email: 'replaced@example.com', name: 'Replaced Responder' }),
      createTestUser({ email: 'override-alex@example.com', name: 'Override Alex' }),
      createTestUser({ email: 'override-taylor@example.com', name: 'Override Taylor' }),
    ]);

    await addScheduleLayerUser(schedule.layers[0].id, replaced.id);

    const results = await Promise.allSettled([
      createScheduleOverrideMutation({
        scheduleId: schedule.id,
        userId: alex.id,
        replacesUserId: replaced.id,
        start: new Date('2026-08-30T00:00:00.000Z'),
        end: new Date('2026-08-30T12:00:00.000Z'),
      }),
      createScheduleOverrideMutation({
        scheduleId: schedule.id,
        userId: taylor.id,
        replacesUserId: replaced.id,
        start: new Date('2026-08-30T06:00:00.000Z'),
        end: new Date('2026-08-30T18:00:00.000Z'),
      }),
    ]);

    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(appErrorCodes(results)).toEqual(['SCHEDULE_OVERRIDE_CONFLICT']);
    expect(
      await testPrisma.onCallOverride.count({
        where: { scheduleId: schedule.id, replacesUserId: replaced.id },
      })
    ).toBe(1);
  });

  it('rejects a replacement target that is not assigned to the schedule', async () => {
    const [schedule, replacement, unrelated] = await Promise.all([
      createScheduleWithTwoLayers(),
      createTestUser({ email: 'valid-replacement@example.com', name: 'Valid Replacement' }),
      createTestUser({ email: 'unrelated-target@example.com', name: 'Unrelated Target' }),
    ]);

    await expect(
      createScheduleOverrideMutation({
        scheduleId: schedule.id,
        userId: replacement.id,
        replacesUserId: unrelated.id,
        start: new Date('2026-08-30T00:00:00.000Z'),
        end: new Date('2026-08-30T12:00:00.000Z'),
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});
