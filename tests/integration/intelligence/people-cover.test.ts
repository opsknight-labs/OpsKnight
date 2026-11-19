import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { generateOpsRollups } from '@/lib/metric-rollup';
import { suggestCoverCandidates } from '@/lib/intelligence/people/cover';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

const DAY = 86_400_000;
const NOW = new Date();
const TODAY = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()));
const at = (daysAgo: number, hour: number) =>
  new Date(TODAY.getTime() - daysAgo * DAY + hour * 3_600_000);
// Tomorrow 10:00-12:00 UTC: daytime in UTC, night in Auckland.
const START = at(-1, 10);
const END = at(-1, 12);

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const actorOf = async (id: string) => (await resolveUserActor(id))!;

async function seed(peopleInsightsEnabled = true) {
  await db.intelligenceSettings.create({
    data: {
      id: 'default',
      ...INTELLIGENCE_SETTINGS_DEFAULTS,
      enabled: true,
      peopleInsightsEnabled,
    },
  });
  const [admin, onCall, busy, quiet, owl, outsider, gone] = await Promise.all([
    createTestUser({ name: 'Admin', role: 'ADMIN' }),
    createTestUser({ name: 'On call' }),
    createTestUser({ name: 'Busy' }),
    createTestUser({ name: 'Quiet' }),
    createTestUser({ name: 'Owl', timeZone: 'Pacific/Auckland' }),
    createTestUser({ name: 'Outsider' }),
    createTestUser({ name: 'Gone', status: 'DISABLED' }),
  ]);
  const schedule = await db.onCallSchedule.create({ data: { name: 'Core', timeZone: 'UTC' } });
  await db.onCallLayer.create({
    data: {
      scheduleId: schedule.id,
      name: 'Primary',
      start: at(30, 0),
      rotationLengthHours: 24,
      users: { create: [{ userId: onCall.id, position: 1 }] },
    },
  });
  const empty = await db.onCallSchedule.create({ data: { name: 'Empty', timeZone: 'UTC' } });
  const team = await createTestTeam('Payments');
  await db.teamMember.createMany({
    data: [busy, quiet, owl, gone].map(user => ({
      teamId: team.id,
      userId: user.id,
      role: 'MEMBER' as const,
    })),
  });
  for (const target of [schedule, empty]) {
    const policy = await db.escalationPolicy.create({
      data: {
        name: `Policy ${target.name}`,
        steps: { create: { stepOrder: 0, targetType: 'SCHEDULE', targetScheduleId: target.id } },
      },
    });
    await createTestService(`svc-${target.name}`, team.id, { escalationPolicyId: policy.id });
  }
  const service = await createTestService('noise');
  for (const daysAgo of [3, 5]) {
    const incident = await createTestIncident(`page ${daysAgo}`, service.id);
    await db.notification.create({
      data: {
        userId: busy.id,
        incidentId: incident.id,
        channel: 'EMAIL',
        createdAt: at(daysAgo, 10),
      },
    });
  }
  await generateOpsRollups(NOW, { force: true, lookbackDays: 35, maxDaysPerRun: 40 });
  return { admin, onCall, busy, quiet, owl, outsider, schedule, empty };
}

describe('override cover suggestions', () => {
  it('ranks free people for a replacement: daytime first, then fewest pages', async () => {
    const { admin, onCall, busy, quiet, owl, schedule } = await seed();
    const result = await suggestCoverCandidates(await actorOf(admin.id), {
      scheduleId: schedule.id,
      start: START,
      end: END,
      replacesUserId: onCall.id,
    });
    expect(result?.gap).toBe(false);
    expect(result?.candidates).toEqual([
      { userId: quiet.id, name: 'Quiet', daytime: true, pages: 0, nightPages: 0 },
      { userId: busy.id, name: 'Busy', daytime: true, pages: 2, nightPages: 0 },
      { userId: owl.id, name: 'Owl', daytime: false, pages: 0, nightPages: 0 },
    ]);
  });

  it('suggests for a gap, stays quiet for covered additive windows, and hides numbers it may not show', async () => {
    const { admin, onCall, schedule, empty } = await seed();
    const covered = await suggestCoverCandidates(await actorOf(admin.id), {
      scheduleId: schedule.id,
      start: START,
      end: END,
    });
    expect(covered).toEqual({ gap: false, windowDays: 28, candidates: [] });

    const gap = await suggestCoverCandidates(await actorOf(admin.id), {
      scheduleId: empty.id,
      start: START,
      end: END,
    });
    expect(gap?.gap).toBe(true);
    expect(gap?.candidates.map(c => c.name)).toEqual(['Quiet', 'Busy', 'Owl']);

    // A schedule member sees neither other people's page counts nor an order derived from them.
    const member = await suggestCoverCandidates(await actorOf(onCall.id), {
      scheduleId: schedule.id,
      start: START,
      end: END,
      replacesUserId: onCall.id,
    });
    expect(member?.candidates.map(c => [c.name, c.pages])).toEqual([
      ['Busy', null],
      ['Quiet', null],
      ['Owl', null],
    ]);
  });

  it('is off without the switch', async () => {
    const { admin, onCall, schedule } = await seed(false);
    expect(
      await suggestCoverCandidates(await actorOf(admin.id), {
        scheduleId: schedule.id,
        start: START,
        end: END,
        replacesUserId: onCall.id,
      })
    ).toBeNull();
  });
});
