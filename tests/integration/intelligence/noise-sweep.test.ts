import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { processEvent, type EventPayload } from '@/lib/events';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  primePrePagingSnapshot,
  resetPrePagingSnapshot,
  setPrePagingDeadlineMs,
} from '@/lib/intelligence/noise-controls';
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

/** Ages every alert of the incident so its latest state change is `ms` old. */
async function ageAlerts(incidentId: string, ms: number) {
  await db.alert.updateMany({
    where: { incidentId },
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
    await runStormCascadeSweep(budget);
    expect((await incident(clear.id)).status).toBe('RESOLVED');
    expect((await incident(firing.id)).status).toBe('OPEN');
    expect(await escalationJobs(firing.id)).toBe(1);

    // Idempotent: the re-paged child is not paged again.
    await runStormCascadeSweep(budget);
    expect(await escalationJobs(firing.id)).toBe(1);
  });
});
