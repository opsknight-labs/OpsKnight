import { beforeEach, describe, expect, it } from 'vitest';
import { processEvent } from '@/lib/events';
import { deleteMaintenanceWindow } from '@/lib/service-maintenance/windows';
import {
  createMaintenanceSchedule,
  deleteMaintenanceSchedule,
  materializeMaintenanceSchedules,
  updateMaintenanceSchedule,
} from '@/lib/service-maintenance/schedules';
import {
  createTestService,
  createTestStatusPage,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const actor = { id: null, source: 'SYSTEM' as const };
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const hhmm = (d: Date) => d.toISOString().slice(11, 16);
const dateKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * A daily UTC schedule whose first occurrence started a minute ago (so it is
 * active now) and runs for an hour. `createdAt` is the clock the schedule was
 * created with, two minutes ago, so the first occurrence is still "upcoming" then.
 */
async function dailyScheduleActiveNow(serviceIds: string[]) {
  const start = new Date(Math.floor((Date.now() - MINUTE) / MINUTE) * MINUTE);
  const createdAt = new Date(start.getTime() - MINUTE);
  const schedule = await createMaintenanceSchedule(
    {
      title: 'Nightly reindex',
      serviceIds,
      frequency: 'DAILY',
      timeZone: 'UTC',
      startTime: hhmm(start),
      durationMinutes: 60,
      startsOn: dateKey(start),
    },
    actor,
    { now: createdAt }
  );
  return { schedule, start };
}

const occurrences = (scheduleId: string) =>
  testPrisma.maintenanceWindow.findMany({
    where: { scheduleId },
    orderBy: { startsAt: 'asc' },
    include: { services: true },
  });

describeIfRealDB('recurring maintenance schedules', { timeout: 120000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates the next two occurrences at once; the scheduler fills 14 days idempotently', async () => {
    const service = await createTestService('Sched Idempotent');
    const now = new Date();
    const schedule = await createMaintenanceSchedule(
      {
        title: 'Weekly patching',
        serviceIds: [service.id],
        frequency: 'DAILY',
        timeZone: 'UTC',
        startTime: '03:00',
        durationMinutes: 120,
        startsOn: dateKey(now),
      },
      actor,
      { now }
    );
    // The request path only creates the next two; the schedule stays due.
    const immediate = await occurrences(schedule.id);
    expect(immediate).toHaveLength(2);
    const created = await testPrisma.maintenanceSchedule.findUniqueOrThrow({
      where: { id: schedule.id },
    });
    expect(created.materializedUntil).toEqual(immediate[1].startsAt);

    const fill = await materializeMaintenanceSchedules(now);
    expect(fill).toMatchObject({ schedules: 1, failed: 0 });
    const first = await occurrences(schedule.id);
    expect(fill.created).toBe(first.length - 2);
    expect(first.slice(0, 2).map(w => w.id)).toEqual(immediate.map(w => w.id));
    expect(first.length).toBeGreaterThanOrEqual(14);
    expect(first.length).toBeLessThanOrEqual(15);
    for (const w of first) {
      expect(w.startsAt.getTime()).toBeGreaterThanOrEqual(now.getTime());
      expect(w.startsAt.getTime()).toBeLessThanOrEqual(now.getTime() + 14 * DAY);
      expect(hhmm(w.startsAt)).toBe('03:00');
      expect(w.endsAt.getTime() - w.startsAt.getTime()).toBe(120 * MINUTE);
      expect(w.services.map(s => s.serviceId)).toEqual([service.id]);
    }

    // Not due yet: nothing to do.
    expect(await materializeMaintenanceSchedules(now)).toMatchObject({ created: 0 });
    // Forget the horizon entirely: still no duplicates.
    await testPrisma.maintenanceSchedule.update({
      where: { id: schedule.id },
      data: { materializedUntil: null },
    });
    expect(await materializeMaintenanceSchedules(now)).toMatchObject({ schedules: 1, created: 0 });
    // Two days later the horizon is topped up with the new days only.
    const later = new Date(now.getTime() + 2 * DAY);
    const topUp = await materializeMaintenanceSchedules(later);
    expect(topUp.created).toBe(2);
    expect(await materializeMaintenanceSchedules(later)).toMatchObject({ created: 0 });
    const all = await occurrences(schedule.id);
    expect(all).toHaveLength(first.length + 2);
    expect(new Set(all.map(w => w.startsAt.getTime())).size).toBe(all.length);
  });

  it('holds alerts during a materialised occurrence like a one-off window', async () => {
    const service = await createTestService('Sched Holds');
    const { schedule } = await dailyScheduleActiveNow([service.id]);
    const [active] = await occurrences(schedule.id);
    expect(active.startsAt.getTime()).toBeLessThanOrEqual(Date.now());

    await processEvent(
      {
        event_action: 'trigger',
        dedup_key: 'held',
        payload: { summary: 'Alert held', source: 'maintenance-test', severity: 'critical' },
      },
      service.id,
      'maint'
    );
    const incident = await testPrisma.incident.findFirstOrThrow({
      where: { serviceId: service.id, dedupKey: 'maint:held' },
    });
    expect(incident.status).toBe('SUPPRESSED');
    expect(incident.maintenanceWindowId).toBe(active.id);
  });

  it('edits replace only upcoming occurrences; the active one is untouched', async () => {
    const service = await createTestService('Sched Edit');
    const { schedule, start } = await dailyScheduleActiveNow([service.id]);
    const before = await occurrences(schedule.id);
    const active = before[0];
    expect(active.startsAt.getTime()).toBe(start.getTime());

    const newTime = hhmm(new Date(start.getTime() + 3 * 60 * MINUTE));
    const updated = await updateMaintenanceSchedule(
      schedule.id,
      { startTime: newTime, title: 'Nightly reindex v2' },
      actor
    );
    expect(updated.revision).toBeGreaterThan(schedule.revision);

    const after = await occurrences(schedule.id);
    const kept = after.find(w => w.id === active.id);
    expect(kept).toMatchObject({
      startsAt: active.startsAt,
      endsAt: active.endsAt,
      title: active.title,
    });
    const upcoming = after.filter(w => w.id !== active.id);
    expect(upcoming.length).toBeGreaterThan(0);
    for (const w of upcoming) {
      expect(hhmm(w.startsAt)).toBe(newTime);
      expect(w.title).toBe('Nightly reindex v2');
      expect(before.some(b => b.id === w.id)).toBe(false);
    }
  });

  it('pausing removes upcoming occurrences and stops new ones; resuming restores them', async () => {
    const service = await createTestService('Sched Pause');
    const { schedule } = await dailyScheduleActiveNow([service.id]);
    const [active] = await occurrences(schedule.id);

    await updateMaintenanceSchedule(schedule.id, { paused: true }, actor);
    expect((await occurrences(schedule.id)).map(w => w.id)).toEqual([active.id]);
    expect(await materializeMaintenanceSchedules(new Date(Date.now() + 2 * DAY))).toMatchObject({
      created: 0,
    });
    expect(await occurrences(schedule.id)).toHaveLength(1);

    const resumed = await updateMaintenanceSchedule(schedule.id, { paused: false }, actor);
    expect(resumed.pausedAt).toBeNull();
    expect(await occurrences(schedule.id)).toHaveLength(3);
    await materializeMaintenanceSchedules(new Date());
    expect((await occurrences(schedule.id)).length).toBeGreaterThanOrEqual(14);
  });

  it('deleting a schedule keeps active and ended occurrences as history', async () => {
    const service = await createTestService('Sched Delete');
    const { schedule } = await dailyScheduleActiveNow([service.id]);
    const [active] = await occurrences(schedule.id);
    const ended = await testPrisma.maintenanceWindow.create({
      data: {
        title: 'Earlier run',
        startsAt: new Date(Date.now() - 2 * DAY),
        endsAt: new Date(Date.now() - 2 * DAY + 60 * MINUTE),
        scheduleId: schedule.id,
      },
    });

    await deleteMaintenanceSchedule(schedule.id, actor);
    expect(
      await testPrisma.maintenanceSchedule.findUnique({ where: { id: schedule.id } })
    ).toBeNull();
    const remaining = await testPrisma.maintenanceWindow.findMany({ orderBy: { startsAt: 'asc' } });
    expect(remaining.map(w => [w.id, w.scheduleId])).toEqual([
      [ended.id, null],
      [active.id, null],
    ]);
  });

  it('does not recreate an occurrence someone deleted by hand', async () => {
    const service = await createTestService('Sched Skip');
    const now = new Date();
    const schedule = await createMaintenanceSchedule(
      {
        title: 'Patch',
        serviceIds: [service.id],
        frequency: 'WEEKLY',
        byWeekday: [0, 1, 2, 3, 4, 5, 6],
        timeZone: 'Europe/London',
        startTime: '04:00',
        durationMinutes: 30,
        startsOn: dateKey(now),
      },
      actor,
      { now }
    );
    await materializeMaintenanceSchedules(now);
    const [skip, ...rest] = await occurrences(schedule.id);
    await deleteMaintenanceWindow(skip.id, actor, { now });
    const topUp = await materializeMaintenanceSchedules(new Date(now.getTime() + 2 * DAY));
    const after = await occurrences(schedule.id);
    expect(after.some(w => w.startsAt.getTime() === skip.startsAt.getTime())).toBe(false);
    expect(topUp.created).toBe(2);
    expect(after.length).toBe(rest.length + 2);
  });

  it('notifies status-page subscribers when each occurrence starts, not weeks ahead', async () => {
    const service = await createTestService('Sched Notify At Start');
    const page = await createTestStatusPage();
    await testPrisma.statusPageService.create({
      data: { statusPageId: page.id, serviceId: service.id, showOnPage: true },
    });
    const now = new Date();
    const schedule = await createMaintenanceSchedule(
      {
        title: 'Nightly reindex',
        serviceIds: [service.id],
        frequency: 'DAILY',
        timeZone: 'UTC',
        startTime: '03:00',
        durationMinutes: 60,
        startsOn: dateKey(new Date(now.getTime() + DAY)),
        publishToStatusPage: true,
      },
      actor,
      { now }
    );
    const windows = await occurrences(schedule.id);
    expect(windows.length).toBeGreaterThan(0);
    for (const window of windows) {
      const announcement = await testPrisma.statusPageAnnouncement.findFirstOrThrow({
        where: { maintenanceWindowId: window.id },
      });
      expect(announcement.notificationTiming).toBe('AT_START');
      const job = await testPrisma.backgroundJob.findFirstOrThrow({
        where: { payload: { path: ['announcementId'], equals: announcement.id } },
      });
      expect(job.scheduledAt.getTime()).toBe(window.startsAt.getTime());
    }
  });

  it('updates upcoming occurrences in place for a text-only edit', async () => {
    const service = await createTestService('Sched Text Edit');
    const page = await createTestStatusPage();
    await testPrisma.statusPageService.create({
      data: { statusPageId: page.id, serviceId: service.id, showOnPage: true },
    });
    const now = new Date();
    const input = {
      title: 'Weekly patching',
      serviceIds: [service.id],
      frequency: 'DAILY' as const,
      timeZone: 'UTC',
      startTime: '03:00',
      durationMinutes: 60,
      startsOn: dateKey(now),
      publishToStatusPage: true,
    };
    const schedule = await createMaintenanceSchedule(input, actor, { now });
    await materializeMaintenanceSchedules(now);
    const before = await occurrences(schedule.id);
    const announcementsBefore = await testPrisma.statusPageAnnouncement.findMany({
      where: { maintenanceWindowId: { in: before.map(w => w.id) } },
      orderBy: { id: 'asc' },
    });
    expect(announcementsBefore).toHaveLength(before.length);
    const fanout = (mode: string) =>
      testPrisma.backgroundJob.count({
        where: { payload: { path: ['deliveryMode'], equals: mode } },
      });
    // Pretend the original announcements were delivered.
    await testPrisma.backgroundJob.updateMany({
      where: { type: 'STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2' },
      data: { status: 'COMPLETED' },
    });
    const allEligibleBefore = await fanout('ALL_ELIGIBLE');
    expect(allEligibleBefore).toBe(before.length);

    // The UI resends every field; only the text actually changes.
    await updateMaintenanceSchedule(
      schedule.id,
      { ...input, title: 'Weekly patching (db)', description: 'Rolling restarts' },
      actor,
      { now }
    );

    const after = await occurrences(schedule.id);
    expect(after.map(w => w.id)).toEqual(before.map(w => w.id));
    expect(after.map(w => w.startsAt)).toEqual(before.map(w => w.startsAt));
    for (const w of after) {
      expect(w.title).toBe('Weekly patching (db)');
      expect(w.description).toBe('Rolling restarts');
    }
    const announcementsAfter = await testPrisma.statusPageAnnouncement.findMany({
      where: { maintenanceWindowId: { in: after.map(w => w.id) } },
      orderBy: { id: 'asc' },
    });
    expect(announcementsAfter.map(a => a.id)).toEqual(announcementsBefore.map(a => a.id));
    expect(announcementsAfter.every(a => a.title === 'Weekly patching (db)')).toBe(true);
    // No announcement is recreated and no ALL_ELIGIBLE fan-out is queued, so nobody
    // already notified is emailed again. The existing announcement sync does bump the
    // generation and queue an UNDELIVERED_ONLY fan-out (subscribers never yet emailed).
    expect(await fanout('ALL_ELIGIBLE')).toBe(allEligibleBefore);
    expect(await fanout('UNDELIVERED_ONLY')).toBe(before.length);
    expect(announcementsAfter.map(a => a.notificationGeneration)).toEqual(
      announcementsBefore.map(a => a.notificationGeneration + 1)
    );
    const schedulesAfter = await testPrisma.maintenanceSchedule.findUniqueOrThrow({
      where: { id: schedule.id },
    });
    expect(schedulesAfter.title).toBe('Weekly patching (db)');
  });

  it('rejects a duration that overlaps the next occurrence', async () => {
    const service = await createTestService('Sched Overlap');
    await expect(
      createMaintenanceSchedule(
        {
          title: 'Too long',
          serviceIds: [service.id],
          frequency: 'DAILY',
          timeZone: 'UTC',
          startTime: '01:00',
          durationMinutes: 1440,
          startsOn: dateKey(new Date()),
        },
        actor
      )
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(await testPrisma.maintenanceSchedule.count()).toBe(0);
  });
});
