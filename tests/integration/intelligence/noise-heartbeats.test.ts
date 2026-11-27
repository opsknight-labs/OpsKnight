import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  primePrePagingSnapshot,
  resetPrePagingSnapshot,
  setPrePagingDeadlineMs,
} from '@/lib/intelligence/noise-controls';
import { createHeartbeatMonitor } from '@/lib/intelligence/noise-controls/manage';
import {
  recordHeartbeat,
  sweepHeartbeatMonitors,
} from '@/lib/intelligence/noise-controls/heartbeats';
import { disconnectNoiseLookupClient } from '@/lib/intelligence/noise-controls/lookup-client';
import {
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

/**
 * A heartbeat is a dead-man's switch: silence must raise an incident that pages, and a ping must close it.
 * Nothing exercised this end to end before.
 */
let actorId = '';
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  resetPrePagingSnapshot();
  setPrePagingDeadlineMs(50);
  await resetDatabase();
  await db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true },
  });
  actorId = (await createTestUser({ role: 'ADMIN' })).id;
});
afterAll(async () => {
  setPrePagingDeadlineMs(null);
  await disconnectNoiseLookupClient();
});

const actor = () => ({ actorId, source: 'UI' as const });

async function monitor(serviceId: string, urgency: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM') {
  return createHeartbeatMonitor(
    { name: 'Nightly backup', serviceId, intervalSeconds: 60, graceSeconds: 30, urgency },
    actor()
  );
}

const pagingJobs = (incidentId: string) =>
  db.backgroundJob.count({
    where: {
      payload: { path: ['incidentId'], equals: incidentId },
      OR: [
        { type: 'ESCALATION', status: 'PENDING' },
        { payload: { path: ['effect'], equals: 'TRIGGER_ESCALATION_NOTIFICATIONS' } },
      ],
    },
  });

describe('heartbeat monitors', () => {
  it('raises nothing before the interval and grace have passed', async () => {
    const service = await createTestService('Backups');
    const { monitor: created } = await monitor(service.id);
    const soon = new Date(created.createdAt.getTime() + 80_000);
    expect(await sweepHeartbeatMonitors(soon)).toMatchObject({ raised: 0, missing: 0, late: 1 });
  });

  it('raises a paged incident when the pings stop, once, and resolves it on the next ping', async () => {
    const service = await createTestService('Backups');
    const { monitor: created, token } = await monitor(service.id);
    const late = new Date(created.createdAt.getTime() + 120_000);

    expect(await sweepHeartbeatMonitors(late)).toMatchObject({ missing: 1, raised: 1 });
    const incident = await db.incident.findFirstOrThrow({ where: { serviceId: service.id } });
    expect(incident.status).toBe('OPEN');
    expect(await pagingJobs(incident.id)).toBe(1);

    // A second sweep does not raise it again.
    expect(await sweepHeartbeatMonitors(new Date(late.getTime() + 60_000))).toMatchObject({
      raised: 0,
    });
    expect(await db.incident.count({ where: { serviceId: service.id } })).toBe(1);

    expect(await recordHeartbeat(token, new Date(late.getTime() + 90_000))).toBe('recovered');
    expect((await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).status).toBe(
      'RESOLVED'
    );
    expect(await recordHeartbeat(token)).toBe('ok');
  });

  it('answers an unknown token like a paused monitor, so tokens cannot be probed', async () => {
    expect(await recordHeartbeat('not-a-token')).toBe('unknown');
  });

  it('pages a HIGH-urgency heartbeat even inside a maintenance window that does not cover critical', async () => {
    const service = await createTestService('Backups');
    await db.noiseMaintenanceWindow.create({
      data: {
        name: 'Patching',
        scope: 'SERVICE',
        serviceId: service.id,
        startsAt: new Date(Date.now() - 60_000),
        endsAt: new Date(Date.now() + 3_600_000),
        effect: 'SUPPRESS',
      },
    });
    await db.noiseControlPolicy.create({
      data: {
        scopeKey: `service:${service.id}`,
        serviceId: service.id,
        mode: 'ON',
        definition: { schemaVersion: 1 } as Prisma.InputJsonObject,
      },
    });
    await primePrePagingSnapshot();
    const { monitor: created } = await monitor(service.id, 'HIGH');
    await sweepHeartbeatMonitors(new Date(created.createdAt.getTime() + 120_000));
    const incident = await db.incident.findFirstOrThrow({ where: { serviceId: service.id } });
    expect(incident.status).toBe('OPEN');
    expect(await pagingJobs(incident.id)).toBe(1);
  });
});
