import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { processEvent, type EventPayload } from '@/lib/events';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  primePrePagingSnapshot,
  resetPrePagingSnapshot,
  setPrePagingDeadlineMs,
} from '@/lib/intelligence/noise-controls';
import { prismaLookups } from '@/lib/intelligence/noise-controls/cache';
import { disconnectNoiseLookupClient } from '@/lib/intelligence/noise-controls/lookup-client';
import {
  resetNoiseSweepSchedule,
  runStormCascadeSweep,
  runUnsuppressSweep,
  scheduleNoiseSweeps,
} from '@/lib/intelligence/noise-controls/sweep';
import { applyIncidentLifecycleCommand } from '@/lib/incidents/lifecycle';
import { createTestService, resetDatabase, testPrisma as db } from '../../helpers/test-db';

/**
 * Noise-control follow-ups that run in the intelligence lane: a suppressed incident whose reason ended
 * (flap settled, maintenance window over) pages while its alert still fires, and a resolved storm parent
 * resolves its clear children and re-pages the ones still firing. Manual suppressions are never touched.
 */

const budget = { maxDbMs: 5_000 };
const integrationId = 'noise-sweep';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  resetPrePagingSnapshot();
  setPrePagingDeadlineMs(50);
  await resetDatabase();
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
});
afterAll(async () => {
  setPrePagingDeadlineMs(null);
  await disconnectNoiseLookupClient();
});

async function policy(serviceId: string, definition: Record<string, unknown>) {
  await db.noiseControlPolicy.create({
    data: {
      scopeKey: `service:${serviceId}`,
      serviceId,
      mode: 'ON',
      definition: { schemaVersion: 1, ...definition } as Prisma.InputJsonObject,
    },
  });
  await primePrePagingSnapshot();
}

const send = (
  serviceId: string,
  dedupKey: string,
  overrides: Partial<EventPayload['payload']> = {},
  action: EventPayload['event_action'] = 'trigger'
) =>
  processEvent(
    {
      event_action: action,
      dedup_key: dedupKey,
      payload: { summary: 'Disk latency', source: 'test', severity: 'error', ...overrides },
    },
    serviceId,
    integrationId
  );

function incidentOf(result: Awaited<ReturnType<typeof processEvent>>) {
  if (!('incident' in result) || !result.incident) throw new Error('expected an incident');
  return result.incident;
}

const incident = (id: string) =>
  db.incident.findUniqueOrThrow({
    where: { id },
    select: { status: true, urgency: true, escalationStatus: true },
  });

const escalationJobs = (incidentId: string) =>
  db.backgroundJob.count({
    where: {
      type: 'ESCALATION',
      status: 'PENDING',
      payload: { path: ['incidentId'], equals: incidentId },
    },
  });

/** Ages every alert of the incident, and its keys' history, so its latest state change is `ms` old. */
async function ageAlerts(incidentId: string, ms: number) {
  const keys = await db.alert.findMany({
    where: { incidentId, dedupKey: { not: null } },
    distinct: ['dedupKey'],
    select: { dedupKey: true },
  });
  await db.alert.updateMany({
    where: { OR: [{ incidentId }, { dedupKey: { in: keys.map(key => key.dedupKey!) } }] },
    data: { createdAt: new Date(Date.now() - ms) },
  });
}

async function flappingIncident(serviceId: string, key: string) {
  await policy(serviceId, { flapping: { enabled: true, threshold: 3, windowSeconds: 60 } });
  const earlier = await db.incident.create({
    data: { title: 'Disk latency', serviceId, status: 'RESOLVED' },
  });
  await db.alert.createMany({
    data: ['TRIGGERED', 'RESOLVED', 'TRIGGERED', 'RESOLVED'].map((status, i) => ({
      serviceId,
      incidentId: earlier.id,
      dedupKey: `${integrationId}:${key}`,
      status,
      payload: {},
      createdAt: new Date(Date.now() - (i + 1) * 2_000),
    })),
  });
  const result = await send(serviceId, key);
  expect(result.action).toBe('suppressed');
  return incidentOf(result).id;
}

describe('schedule', () => {
  it('queues a sweep only when it has candidates', async () => {
    resetNoiseSweepSchedule();
    expect(await scheduleNoiseSweeps(Date.now())).toBe(0);
    const service = await createTestService('Schedule');
    await flappingIncident(service.id, 'disk-0');
    resetNoiseSweepSchedule();
    expect(await scheduleNoiseSweeps(Date.now())).toBe(1);
    expect(
      await db.intelligenceWorkItem.findMany({ select: { kind: true, subjectKey: true } })
    ).toEqual([{ kind: 'NOISE_SWEEP', subjectKey: 'unsuppress' }]);
  });
});

describe('un-suppress sweep', () => {
  it('pages a flap-suppressed incident once the flap has been quiet and the alert still fires', async () => {
    const service = await createTestService('Flapping');
    const id = await flappingIncident(service.id, 'disk-1');

    // Not quiet long enough yet: nothing happens.
    await runUnsuppressSweep(budget);
    expect((await incident(id)).status).toBe('SUPPRESSED');

    await ageAlerts(id, 61_000);
    await runUnsuppressSweep(budget);
    expect((await incident(id)).status).toBe('OPEN');
    expect(await escalationJobs(id)).toBe(1);

    // Idempotent: a second pass finds nothing to do.
    await runUnsuppressSweep(budget);
    expect(await escalationJobs(id)).toBe(1);
  });

  it('pages a hard-down alert that keeps re-sending after the flap stopped', async () => {
    const service = await createTestService('Flapping hard-down');
    const id = await flappingIncident(service.id, 'disk-hd');
    await ageAlerts(id, 61_000);
    // Re-sent every 60s while down: new TRIGGERED rows, but no state change since the flap.
    await send(service.id, 'disk-hd');
    expect((await incident(id)).status).toBe('SUPPRESSED');

    await runUnsuppressSweep(budget);
    expect((await incident(id)).status).toBe('OPEN');
    expect(await escalationJobs(id)).toBe(1);
  });

  it('one failing incident does not stop the rest of the page', async () => {
    const first = await flappingIncident((await createTestService('Isolate A')).id, 'disk-a');
    const second = await flappingIncident((await createTestService('Isolate B')).id, 'disk-b');
    await ageAlerts(first, 61_000);
    await ageAlerts(second, 61_000);
    // A trigger that rejects UNSUPPRESS for the first incident only.
    await db.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION noise_sweep_fail() RETURNS trigger AS $$
      BEGIN
        IF NEW.id = '${first}' AND NEW.status = 'OPEN' THEN RAISE EXCEPTION 'boom'; END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql`);
    await db.$executeRawUnsafe(
      `CREATE TRIGGER noise_sweep_fail BEFORE UPDATE ON "Incident" FOR EACH ROW EXECUTE FUNCTION noise_sweep_fail()`
    );
    try {
      await runUnsuppressSweep(budget);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER noise_sweep_fail ON "Incident"`);
      await db.$executeRawUnsafe(`DROP FUNCTION noise_sweep_fail()`);
    }
    expect((await incident(first)).status).toBe('SUPPRESSED');
    expect((await incident(second)).status).toBe('OPEN');
  });

  it('leaves a flap-suppressed incident whose alert is clear', async () => {
    const service = await createTestService('Flapping clear');
    const id = await flappingIncident(service.id, 'disk-2');
    await db.alert.create({
      data: {
        serviceId: service.id,
        incidentId: id,
        dedupKey: `${integrationId}:other`,
        status: 'RESOLVED',
        payload: {},
      },
    });
    await ageAlerts(id, 61_000);
    await runUnsuppressSweep(budget);
    expect((await incident(id)).status).toBe('SUPPRESSED');
  });

  it('pages a maintenance-suppressed incident once its window ended', async () => {
    const service = await createTestService('Maintenance');
    const window = await db.noiseMaintenanceWindow.create({
      data: {
        name: 'Patching',
        scope: 'SERVICE',
        serviceId: service.id,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3_600_000),
      },
    });
    await policy(service.id, {});
    const id = incidentOf(await send(service.id, 'patch-1')).id;
    expect((await incident(id)).status).toBe('SUPPRESSED');

    await runUnsuppressSweep(budget);
    expect((await incident(id)).status).toBe('SUPPRESSED');

    await db.noiseMaintenanceWindow.update({
      where: { id: window.id },
      data: { endedAt: new Date(Date.now() - 1_000) },
    });
    await runUnsuppressSweep(budget);
    expect((await incident(id)).status).toBe('OPEN');
    expect(await escalationJobs(id)).toBe(1);
  });

  it('leaves an incident held by product maintenance to its own end sweep', async () => {
    const service = await createTestService('Product maintenance');
    const startsAt = new Date(Date.now() - 60_000);
    const endsAt = new Date(Date.now() + 3_600_000);
    const window = await db.maintenanceWindow.create({
      data: {
        title: 'DB upgrade',
        startsAt,
        endsAt,
        services: { create: { serviceId: service.id, startsAt, endsAt } },
      },
    });
    await policy(service.id, {});
    const id = incidentOf(await send(service.id, 'held-1')).id;
    expect(await db.incident.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: 'SUPPRESSED',
      maintenanceWindowId: window.id,
    });

    // The window has ended but the product end sweep has not processed it yet.
    await db.maintenanceWindow.update({
      where: { id: window.id },
      data: { endsAt: new Date(Date.now() - 1_000) },
    });
    await ageAlerts(id, 3_600_000);
    await runUnsuppressSweep(budget);
    expect((await incident(id)).status).toBe('SUPPRESSED');
  });

  it('never touches a manual suppression', async () => {
    const service = await createTestService('Manual');
    const id = incidentOf(await send(service.id, 'manual-1')).id;
    await db.$transaction(tx =>
      applyIncidentLifecycleCommand(tx, { incidentId: id, command: 'SUPPRESS', source: 'WEB' })
    );
    await ageAlerts(id, 3_600_000);
    await runUnsuppressSweep(budget);
    expect((await incident(id)).status).toBe('SUPPRESSED');
  });
});

describe('storm parent', () => {
  it('rises to the highest child urgency', async () => {
    const service = await createTestService('Storm urgency');
    await policy(service.id, {
      allowHighUrgency: true,
      storm: { enabled: true, threshold: 2, windowSeconds: 60 },
    });
    const parent = incidentOf(await send(service.id, 'edge-1', { severity: 'info' }));
    expect(parent.urgency).toBe('LOW');
    // Threshold 2: the third incident in the window is the first one grouped.
    await send(service.id, 'edge-2', { severity: 'info' });
    const child = await send(service.id, 'edge-3', { severity: 'critical' });
    expect(child.action).toBe('grouped');
    expect((await incident(parent.id)).urgency).toBe('HIGH');
  });

  it('never picks an unpaged storm child as the parent of a new incident', async () => {
    const service = await createTestService('Storm child parent');
    await policy(service.id, { storm: { enabled: true, threshold: 2, windowSeconds: 60 } });
    const parent = incidentOf(await send(service.id, 'edge-1'));
    const second = incidentOf(await send(service.id, 'edge-2'));
    const child = incidentOf(await send(service.id, 'edge-3'));
    expect((await incident(child.id)).escalationStatus).toBe('COMPLETED');
    await db.incident.updateMany({
      where: { id: { in: [parent.id, second.id] } },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });

    const since = new Date(Date.now() - 60_000);
    expect(await prismaLookups(db).findStormParent([service.id], since, service.id)).toBeNull();
    const next = await send(service.id, 'edge-4');
    expect(next.action).toBe('triggered');
    expect((await incident(incidentOf(next).id)).escalationStatus).not.toBe('COMPLETED');
  });

  it('on parent resolve, resolves clear children and re-pages the ones still firing', async () => {
    const service = await createTestService('Storm cascade');
    await policy(service.id, { storm: { enabled: true, threshold: 2, windowSeconds: 60 } });
    const parent = incidentOf(await send(service.id, 'edge-1'));
    await send(service.id, 'edge-2');
    const clear = incidentOf(await send(service.id, 'edge-3'));
    const firing = incidentOf(await send(service.id, 'edge-4'));
    expect((await incident(clear.id)).escalationStatus).toBe('COMPLETED');
    expect(await escalationJobs(firing.id)).toBe(0);

    // A clear child's resolve arrives while the parent is still open: nothing cascades yet.
    await db.alert.create({
      data: {
        serviceId: service.id,
        incidentId: clear.id,
        dedupKey: `${integrationId}:edge-3`,
        status: 'RESOLVED',
        payload: {},
      },
    });
    await runStormCascadeSweep(budget);
    expect((await incident(clear.id)).status).toBe('OPEN');

    expect((await send(service.id, 'edge-1', {}, 'resolve')).action).toBe('resolved');
    expect((await incident(parent.id)).status).toBe('RESOLVED');
    await runStormCascadeSweep(budget);
    expect((await incident(clear.id)).status).toBe('RESOLVED');
    expect((await incident(firing.id)).status).toBe('OPEN');
    expect(await escalationJobs(firing.id)).toBe(1);

    // Idempotent: the re-paged child is not paged again.
    await runStormCascadeSweep(budget);
    expect(await escalationJobs(firing.id)).toBe(1);
  });

  it('resolves clear children past a required custom field and still pages the rest', async () => {
    const service = await createTestService('Storm required field');
    await policy(service.id, { storm: { enabled: true, threshold: 2, windowSeconds: 60 } });
    await db.customField.create({
      data: {
        name: 'Root cause',
        key: 'root_cause',
        type: 'TEXT',
        required: true,
        createdAt: new Date(Date.now() - 60_000),
      },
    });
    const parent = incidentOf(await send(service.id, 'edge-1'));
    await send(service.id, 'edge-2');
    const clear = incidentOf(await send(service.id, 'edge-3'));
    const firing = incidentOf(await send(service.id, 'edge-4'));
    await db.alert.create({
      data: {
        serviceId: service.id,
        incidentId: clear.id,
        dedupKey: `${integrationId}:edge-3`,
        status: 'RESOLVED',
        payload: {},
      },
    });
    await db.incident.update({
      where: { id: parent.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });

    await runStormCascadeSweep(budget);
    expect((await incident(clear.id)).status).toBe('RESOLVED');
    expect(await escalationJobs(firing.id)).toBe(1);
  });

  it('does not re-page a child whose grouping was reversed and already paged', async () => {
    const service = await createTestService('Storm reversed');
    await policy(service.id, { storm: { enabled: true, threshold: 2, windowSeconds: 60 } });
    const parent = incidentOf(await send(service.id, 'edge-1'));
    await send(service.id, 'edge-2');
    const child = incidentOf(await send(service.id, 'edge-3'));
    await db.prePagingDecision.updateMany({
      where: { incidentId: child.id, action: 'GROUP_CHILD' },
      data: { reversedAt: new Date() },
    });
    await db.incident.update({
      where: { id: parent.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });

    await runStormCascadeSweep(budget);
    expect(await escalationJobs(child.id)).toBe(0);
  });

  it('probes for a cascade only while a resolved parent has an open child to settle', async () => {
    const service = await createTestService('Storm probe');
    await policy(service.id, { storm: { enabled: true, threshold: 2, windowSeconds: 60 } });
    const parent = incidentOf(await send(service.id, 'edge-1'));
    await send(service.id, 'edge-2');
    const child = incidentOf(await send(service.id, 'edge-3'));
    resetNoiseSweepSchedule();
    expect(await scheduleNoiseSweeps(Date.now())).toBe(0); // parent still open

    await db.incident.update({
      where: { id: child.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    await db.incident.update({
      where: { id: parent.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    resetNoiseSweepSchedule();
    expect(await scheduleNoiseSweeps(Date.now())).toBe(0); // child already closed
    await runStormCascadeSweep(budget);
    const link = await db.incidentRelationship.findFirstOrThrow({
      where: { sourceIncidentId: child.id },
      select: { evidence: true },
    });
    expect(link.evidence).toMatchObject({ cascadedAt: expect.any(String) });
  });
});
