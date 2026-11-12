import { beforeEach, expect, it } from 'vitest';
import {
  backfillOnCallCoverage,
  captureScheduleCoverage,
  loadMyOnCallLoad,
  loadScheduleLoad,
} from '@/lib/oncall-load/store';
import { ONCALL_INSIGHT_KINDS } from '@/lib/oncall-load/insights';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

const NOW = new Date('2026-06-15T12:00:00.000Z');

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

async function rotation(name: string, userIds: string[]) {
  const schedule = await db.onCallSchedule.create({ data: { name, timeZone: 'UTC' } });
  await db.onCallLayer.create({
    data: {
      scheduleId: schedule.id,
      name: 'Primary',
      start: new Date('2026-05-01T00:00:00.000Z'),
      rotationLengthHours: 24,
      users: { create: userIds.map((userId, index) => ({ userId, position: index + 1 })) },
    },
  });
  return schedule;
}

async function seed() {
  const [asha, bo, cy, lead, admin] = await Promise.all([
    createTestUser({ name: 'Asha', timeZone: 'America/New_York' }),
    createTestUser({ name: 'Bo' }),
    createTestUser({ name: 'Cy' }),
    createTestUser({ name: 'Lead' }),
    createTestUser({ name: 'Admin', role: 'ADMIN' }),
  ]);
  const team = await createTestTeam('Payments');
  await db.teamMember.createMany({
    data: [
      { teamId: team.id, userId: lead.id, role: 'OWNER' },
      { teamId: team.id, userId: bo.id, role: 'MEMBER' },
    ],
  });
  const service = await createTestService('api');
  const page = async (userId: string, iso: string, channels = ['EMAIL'] as const) => {
    const incident = await createTestIncident(`page ${iso}`, service.id);
    await db.notification.createMany({
      data: channels.map(channel => ({
        userId,
        incidentId: incident.id,
        channel,
        createdAt: new Date(iso),
      })),
    });
  };
  // Asha: nine pages. 03:30Z is 23:30 the evening before in New York (night); 6 June is a Saturday.
  await page(asha.id, '2026-06-02T03:30:00.000Z');
  await page(asha.id, '2026-06-06T14:00:00.000Z');
  for (let day = 20; day <= 26; day += 1) await page(asha.id, `2026-05-${day}T15:00:00.000Z`);
  // Two channels for one incident in one hour are one page.
  await db.notification.create({
    data: {
      userId: asha.id,
      channel: 'SMS',
      createdAt: new Date('2026-06-02T03:40:00.000Z'),
      incidentId: (
        await db.incident.findFirstOrThrow({
          where: { title: 'page 2026-06-02T03:30:00.000Z' },
        })
      ).id,
    },
  });
  await page(bo.id, '2026-06-03T10:00:00.000Z');
  // Outside the window and without an incident: neither counts.
  await page(bo.id, '2026-04-01T10:00:00.000Z');
  await db.notification.create({
    data: { userId: bo.id, channel: 'EMAIL', createdAt: new Date('2026-06-04T10:00:00.000Z') },
  });
  const schedule = await rotation('Core rotation', [asha.id, bo.id, cy.id]);
  return { asha, bo, cy, lead, admin, schedule };
}

it('computes load per person and shows per-person rows only to self, team lead and admin', async () => {
  const { asha, bo, cy, lead, admin, schedule } = await seed();

  const forAdmin = await loadScheduleLoad(schedule.id, admin, NOW);
  expect(forAdmin?.people.map(person => person.name)).toEqual(['Asha', 'Bo', 'Cy']);
  expect(forAdmin?.people[0]).toMatchObject({
    userId: asha.id,
    pages: 9,
    nightPages: 1,
    weekendPages: 1,
    interruptedHours: 9,
  });
  expect(forAdmin?.people[0].onCallHours).toBeGreaterThan(200);
  expect(forAdmin?.people[1]).toMatchObject({ userId: bo.id, pages: 1 });
  expect(forAdmin?.rotation).toMatchObject({ totalPages: 10 });
  expect(forAdmin?.rotation?.fairnessIndex).toBeLessThan(0.6);
  expect(forAdmin?.insights.map(insight => insight.kind)).toEqual([
    ONCALL_INSIGHT_KINDS.unfairRotation,
  ]);

  const forBo = await loadScheduleLoad(schedule.id, bo, NOW);
  expect(forBo?.people.map(person => person.userId)).toEqual([bo.id]);
  expect(forBo?.rotationSize).toBe(3);
  expect(forBo?.rotation).toMatchObject({ totalPages: 10 });
  expect(forBo?.insights).toEqual([]);

  const forLead = await loadScheduleLoad(schedule.id, lead, NOW);
  expect(forLead?.people.map(person => person.userId)).toEqual([bo.id]);

  const forCy = await loadScheduleLoad(schedule.id, cy, NOW);
  expect(forCy?.people.map(person => person.userId)).toEqual([cy.id]);

  // With two people, totals plus your own row would reveal the other person's numbers.
  const pair = await rotation('Pair rotation', [asha.id, bo.id]);
  expect((await loadScheduleLoad(pair.id, bo, NOW))?.rotation).toBeNull();
  expect((await loadScheduleLoad(pair.id, admin, NOW))?.rotation).not.toBeNull();
});

it('captures finished days once, resumes, and keeps history after the layer is gone', async () => {
  const { asha, admin, schedule } = await seed();

  const written = await captureScheduleCoverage(schedule.id, { now: NOW });
  expect(written).toBe(30);
  const days = await db.onCallCoverageDay.findMany({ where: { scheduleId: schedule.id } });
  expect(days.every(day => day.seconds === 86_400)).toBe(true);
  expect(Math.max(...days.map(day => day.date.getTime()))).toBe(Date.parse('2026-06-14'));
  expect(await captureScheduleCoverage(schedule.id, { now: NOW })).toBe(0);

  // A later run adds only the newly finished day.
  const nextDay = new Date(NOW.getTime() + 24 * 3_600_000);
  expect(await captureScheduleCoverage(schedule.id, { now: nextDay })).toBe(1);

  const before = await loadScheduleLoad(schedule.id, admin, NOW);
  await db.onCallLayer.deleteMany({ where: { scheduleId: schedule.id } });
  const after = await loadScheduleLoad(schedule.id, admin, NOW);
  expect(after?.people.map(person => [person.userId, person.onCallHours])).toEqual(
    before?.people.map(person => [person.userId, person.onCallHours])
  );

  const mine = await loadMyOnCallLoad(asha.id, NOW);
  expect(mine).toMatchObject({ userId: asha.id, pages: 9, nightPages: 1, weekendPages: 1 });
  expect(mine.onCallHours).toBeGreaterThan(200);
  expect(mine.daily).toHaveLength(29);
});

it('backfills every schedule in resumable batches', async () => {
  const { asha, bo } = await seed();
  await rotation('Second rotation', [asha.id, bo.id]);

  const first = await backfillOnCallCoverage({ batchSize: 1, now: NOW });
  expect(first).toMatchObject({ schedules: 1, rows: 30 });
  expect(first.nextCursor).not.toBeNull();
  const second = await backfillOnCallCoverage({ batchSize: 1, now: NOW, cursor: first.nextCursor });
  expect(second).toMatchObject({ schedules: 1, rows: 30 });
  const third = await backfillOnCallCoverage({ batchSize: 1, now: NOW, cursor: second.nextCursor });
  expect(third).toEqual({ nextCursor: null, schedules: 0, rows: 0 });
  // Starting over is harmless.
  expect(await backfillOnCallCoverage({ now: NOW })).toMatchObject({ schedules: 2, rows: 0 });
});
