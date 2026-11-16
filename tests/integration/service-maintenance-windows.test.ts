import { beforeEach, describe, expect, it } from 'vitest';
import { processEvent } from '@/lib/events';
import {
  createMaintenanceWindow,
  deleteMaintenanceWindow,
  endMaintenanceWindowNow,
  processEndedMaintenanceWindow,
  processEndedMaintenanceWindows,
  updateMaintenanceWindow,
} from '@/lib/service-maintenance/windows';
import {
  createTestService,
  createTestStatusPage,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const actor = { id: null, source: 'SYSTEM' as const };
const HOUR = 60 * 60_000;

function trigger(serviceId: string, key: string) {
  return processEvent(
    {
      event_action: 'trigger',
      dedup_key: key,
      payload: { summary: `Alert ${key}`, source: 'maintenance-test', severity: 'critical' },
    },
    serviceId,
    'maint'
  );
}

function resolve(serviceId: string, key: string) {
  return processEvent(
    {
      event_action: 'resolve',
      dedup_key: key,
      payload: { summary: `Alert ${key}`, source: 'maintenance-test', severity: 'critical' },
    },
    serviceId,
    'maint'
  );
}

async function openWindow(serviceIds: string[], extra: Record<string, unknown> = {}) {
  const now = new Date();
  return createMaintenanceWindow(
    {
      title: 'DB upgrade',
      serviceIds,
      startsAt: now,
      endsAt: new Date(now.getTime() + HOUR),
      ...extra,
    },
    actor,
    { now }
  );
}

const incidentFor = (serviceId: string, key: string) =>
  testPrisma.incident.findFirstOrThrow({
    where: { serviceId, dedupKey: `maint:${key}` },
    include: { slaPauses: true, events: true },
  });

describeIfRealDB('service maintenance windows', { timeout: 60000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('holds new alerts as SUPPRESSED without paging and pauses the SLA clock', async () => {
    const service = await createTestService('Maint Held');
    const window = await openWindow([service.id]);

    const result = await trigger(service.id, 'held');
    expect(result.action).toBe('suppressed');

    const incident = await incidentFor(service.id, 'held');
    expect(incident.status).toBe('SUPPRESSED');
    expect(incident.maintenanceWindowId).toBe(window.id);
    expect(incident.escalationStatus).toBe('COMPLETED');
    expect(incident.nextEscalationAt).toBeNull();
    expect(incident.slaPauses.map(p => p.reason)).toEqual(['maintenance-window']);
    expect(incident.events.some(e => e.message.includes('maintenance window'))).toBe(true);
  });

  it('does not hold alerts for other services or before the window starts', async () => {
    const inWindow = await createTestService('Maint In');
    const other = await createTestService('Maint Other');
    const now = new Date();
    await openWindow([inWindow.id]);
    const upcoming = await createTestService('Maint Upcoming');
    await createMaintenanceWindow(
      {
        title: 'Later',
        serviceIds: [upcoming.id],
        startsAt: new Date(now.getTime() + HOUR),
        endsAt: new Date(now.getTime() + 2 * HOUR),
      },
      actor
    );

    expect((await trigger(other.id, 'a')).action).toBe('triggered');
    expect((await trigger(upcoming.id, 'b')).action).toBe('triggered');
  });

  it('keeps an incident that was already open before the window escalating', async () => {
    const service = await createTestService('Maint Preexisting');
    await trigger(service.id, 'pre');
    await openWindow([service.id]);

    expect((await trigger(service.id, 'pre')).action).toBe('deduplicated');
    expect((await incidentFor(service.id, 'pre')).status).toBe('OPEN');
  });

  it('lets a resolve during the window close the held incident', async () => {
    const service = await createTestService('Maint Resolve');
    await openWindow([service.id]);
    await trigger(service.id, 'flap');
    await resolve(service.id, 'flap');
    expect((await incidentFor(service.id, 'flap')).status).toBe('RESOLVED');
  });

  it('releases still-firing held incidents for paging when the window ends, exactly once', async () => {
    const service = await createTestService('Maint Resume');
    const window = await openWindow([service.id]);
    await trigger(service.id, 'firing');
    await trigger(service.id, 'recovered');
    await resolve(service.id, 'recovered');

    const after = new Date(window.endsAt.getTime() + 1000);
    const first = await processEndedMaintenanceWindow(window.id, after);
    expect(first).toEqual({ released: 1, complete: true });

    const firing = await incidentFor(service.id, 'firing');
    expect(firing.status).toBe('OPEN');
    expect(firing.slaPauses.every(p => p.endedAt !== null)).toBe(true);
    expect((await incidentFor(service.id, 'recovered')).status).toBe('RESOLVED');

    const row = await testPrisma.maintenanceWindow.findUniqueOrThrow({ where: { id: window.id } });
    expect(row.endProcessedAt).not.toBeNull();
    expect(await processEndedMaintenanceWindow(window.id, after)).toEqual({
      released: 0,
      complete: true,
    });
  });

  it('auto-resolves held incidents when the window uses RESOLVE_HELD', async () => {
    const service = await createTestService('Maint Resolve Held');
    const window = await openWindow([service.id], { endBehavior: 'RESOLVE_HELD' });
    await trigger(service.id, 'held');

    const result = await processEndedMaintenanceWindows(new Date(window.endsAt.getTime() + 1000));
    expect(result).toEqual({ windows: 1, released: 1 });
    const incident = await incidentFor(service.id, 'held');
    expect(incident.status).toBe('RESOLVED');
    expect(incident.resolutionKind).toBe('AUTOMATION');
  });

  it('never overrides a responder who already acted on a held incident', async () => {
    const service = await createTestService('Maint Responder');
    const window = await openWindow([service.id], { endBehavior: 'RESOLVE_HELD' });
    await trigger(service.id, 'acked');
    const held = await incidentFor(service.id, 'acked');
    await testPrisma.incident.update({ where: { id: held.id }, data: { status: 'ACKNOWLEDGED' } });

    const result = await processEndedMaintenanceWindow(
      window.id,
      new Date(window.endsAt.getTime() + 1000)
    );
    expect(result.released).toBe(0);
    expect((await incidentFor(service.id, 'acked')).status).toBe('ACKNOWLEDGED');
  });

  it('end now stops holding immediately and releases held incidents', async () => {
    const service = await createTestService('Maint End Now');
    const window = await openWindow([service.id]);
    await trigger(service.id, 'held');

    const ended = await endMaintenanceWindowNow(window.id, actor);
    expect(ended.endsAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect((await incidentFor(service.id, 'held')).status).toBe('OPEN');
    expect((await trigger(service.id, 'after-end')).action).toBe('triggered');
  });

  it('enforces lifecycle rules', async () => {
    const service = await createTestService('Maint Rules');
    const now = new Date();
    await expect(
      createMaintenanceWindow(
        { title: 'Bad', serviceIds: [service.id], startsAt: now, endsAt: now },
        actor
      )
    ).rejects.toThrow(/End must be after start/);
    await expect(
      createMaintenanceWindow(
        {
          title: 'Too long',
          serviceIds: [service.id],
          startsAt: now,
          endsAt: new Date(now.getTime() + 8 * 24 * HOUR),
        },
        actor
      )
    ).rejects.toThrow(/at most 7 days/);

    const active = await openWindow([service.id]);
    await expect(deleteMaintenanceWindow(active.id, actor)).rejects.toThrow(/Only upcoming/);
    await expect(
      updateMaintenanceWindow(active.id, { startsAt: new Date(now.getTime() + HOUR) }, actor)
    ).rejects.toThrow(/start of an active/);

    const extended = await updateMaintenanceWindow(
      active.id,
      { endsAt: new Date(active.endsAt.getTime() + HOUR) },
      actor
    );
    expect(extended.endsAt.getTime()).toBe(active.endsAt.getTime() + HOUR);
    const joinRow = await testPrisma.maintenanceWindowService.findFirstOrThrow({
      where: { windowId: active.id },
    });
    expect(joinRow.endsAt.getTime()).toBe(extended.endsAt.getTime());

    await endMaintenanceWindowNow(active.id, actor);
    await expect(updateMaintenanceWindow(active.id, { title: 'Renamed' }, actor)).rejects.toThrow(
      /ended maintenance window/
    );
  });

  it('publishes and withdraws a linked status-page announcement', async () => {
    const shown = await createTestService('Maint Shown');
    const hidden = await createTestService('Maint Not On Page');
    const page = await createTestStatusPage();
    await testPrisma.statusPageService.create({
      data: { statusPageId: page.id, serviceId: shown.id, showOnPage: true },
    });

    const window = await openWindow([shown.id, hidden.id], { publishToStatusPage: true });
    const announcements = await testPrisma.statusPageAnnouncement.findMany({
      where: { maintenanceWindowId: window.id },
    });
    expect(announcements).toHaveLength(1);
    expect(announcements[0]).toMatchObject({
      statusPageId: page.id,
      type: 'MAINTENANCE',
      affectedServiceIds: [shown.id],
    });
    expect(
      await testPrisma.backgroundJob.count({
        where: { payload: { path: ['announcementId'], equals: announcements[0].id } },
      })
    ).toBe(1);

    await updateMaintenanceWindow(window.id, { publishToStatusPage: false }, actor);
    expect(
      await testPrisma.statusPageAnnouncement.count({ where: { maintenanceWindowId: window.id } })
    ).toBe(0);
  });
});
