import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { processEvent, type EventPayload } from '@/lib/events';
import {
  primePrePagingSnapshot,
  resetPrePagingSnapshot,
  setPrePagingDeadlineMs,
} from '@/lib/intelligence/noise-controls';
import {
  disconnectNoiseLookupClient,
  setNoiseLookupRoute,
} from '@/lib/intelligence/noise-controls/lookup-client';

/**
 * The pre-paging hook on the real ingestion path at the production 5 ms deadline: concurrent bursts stay
 * correct (every event either pages or is grouped under an incident that paged), HIGH urgency is never
 * held, and a broken hook (missing tables, failing lookups) still pages.
 */

const services: string[] = [];

beforeAll(() => {
  const url = new URL(process.env.DATABASE_URL!);
  expect(url.hostname).toBe('127.0.0.1');
  expect(url.pathname).toMatch(/^\/ingestion_test_/);
  setPrePagingDeadlineMs(null);
});

afterEach(() => resetPrePagingSnapshot());

afterAll(async () => {
  const owned = { serviceId: { in: services } };
  await prisma.alert.deleteMany({ where: owned });
  await prisma.incident.deleteMany({ where: owned });
  await prisma.service.deleteMany({ where: { id: { in: services } } });
  await disconnectNoiseLookupClient();
  await prisma.$disconnect();
});

async function serviceWith(mode: 'OFF' | 'SHADOW' | 'ON', definition: Record<string, unknown>) {
  const service = await prisma.service.create({ data: { name: `Noise hook ${randomUUID()}` } });
  services.push(service.id);
  await prisma.noiseControlPolicy.create({
    data: {
      scopeKey: `service:${service.id}`,
      serviceId: service.id,
      mode,
      definition: { schemaVersion: 1, ...definition } as Prisma.InputJsonObject,
    },
  });
  await primePrePagingSnapshot();
  return service.id;
}

const event = (severity: EventPayload['payload']['severity'] = 'error'): EventPayload => ({
  event_action: 'trigger',
  dedup_key: randomUUID(),
  payload: { summary: `Edge 5xx ${randomUUID().slice(0, 6)}`, source: 'bench', severity },
});

async function pagingJob(incidentId: string) {
  return prisma.backgroundJob.findFirst({
    where: {
      AND: [
        { payload: { path: ['incidentId'], equals: incidentId } },
        { payload: { path: ['effect'], equals: 'TRIGGER_ESCALATION_NOTIFICATIONS' } },
      ],
    },
    select: { scheduledAt: true },
  });
}

it('a concurrent storm burst never loses an event and pages every parent exactly once', async () => {
  const serviceId = await serviceWith('ON', {
    storm: { enabled: true, threshold: 3, windowSeconds: 60 },
  });
  const results = await Promise.all(
    Array.from({ length: 30 }, () => processEvent(event(), serviceId, 'noise-hook'))
  );
  expect(results.every(result => 'incident' in result && result.incident)).toBe(true);
  const incidents = await prisma.incident.findMany({ where: { serviceId }, select: { id: true } });
  expect(incidents).toHaveLength(30);
  const links = await prisma.incidentRelationship.findMany({
    where: { sourceIncidentId: { in: incidents.map(incident => incident.id) } },
    select: { sourceIncidentId: true, targetIncidentId: true, type: true },
  });
  const children = new Map(links.map(link => [link.sourceIncidentId, link.targetIncidentId]));
  for (const incident of incidents) {
    const job = await pagingJob(incident.id);
    const parent = children.get(incident.id);
    if (parent) {
      expect(job).toBeNull();
      // A child's parent is not itself a child, and it paged.
      expect(children.has(parent)).toBe(false);
      expect(await pagingJob(parent)).not.toBeNull();
    } else {
      expect(job).not.toBeNull();
    }
  }
  expect(links.every(link => link.type === 'PARENT_CHILD')).toBe(true);
});

it('never holds HIGH urgency, even when the policy opts HIGH in', async () => {
  for (const allowHighUrgency of [false, true]) {
    const serviceId = await serviceWith('ON', {
      allowHighUrgency,
      storm: { enabled: true, threshold: 40, windowSeconds: 60, holdSeconds: 60 },
    });
    for (let i = 0; i < 25; i += 1) {
      const result = await processEvent(event('critical'), serviceId, 'noise-hook');
      if (!('incident' in result) || !result.incident) throw new Error('expected an incident');
      expect(result.incident.urgency).toBe('HIGH');
      const job = await pagingJob(result.incident.id);
      expect(job?.scheduledAt.getTime()).toBeLessThan(Date.now() + 5_000);
    }
  }
});

it('pages normally when the noise-control tables are missing', async () => {
  const serviceId = await serviceWith('ON', { storm: { enabled: true, threshold: 2 } });
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "NoiseControlPolicy" RENAME TO "NoiseControlPolicy_x"'
  );
  try {
    resetPrePagingSnapshot();
    // The refresh fails and the snapshot stays cold: every event fails open.
    expect(await primePrePagingSnapshot()).toBeNull();
    for (let i = 0; i < 4; i += 1) {
      const result = await processEvent(event(), serviceId, 'noise-hook');
      expect(result.action).toBe('triggered');
    }
  } finally {
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "NoiseControlPolicy_x" RENAME TO "NoiseControlPolicy"'
    );
  }
});

it.each(['pool', 'transaction'] as const)(
  'pages normally when a lookup fails on the %s route',
  async route => {
    setNoiseLookupRoute(route);
    const serviceId = await serviceWith('ON', {
      contentDedup: { enabled: true, requireLabelSubset: false },
      flapping: { enabled: true },
      storm: { enabled: true, threshold: 2 },
    });
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "IncidentFingerprint" RENAME TO "IncidentFingerprint_x"'
    );
    try {
      for (let i = 0; i < 4; i += 1) {
        const result = await processEvent(event(), serviceId, 'noise-hook');
        expect(result.action).toBe('triggered');
        if (!('incident' in result) || !result.incident) throw new Error('expected an incident');
        expect(await pagingJob(result.incident.id)).not.toBeNull();
      }
      expect(await prisma.prePagingDecision.count({ where: { serviceId } })).toBe(0);
    } finally {
      setNoiseLookupRoute(null);
      await prisma.$executeRawUnsafe(
        'ALTER TABLE "IncidentFingerprint_x" RENAME TO "IncidentFingerprint"'
      );
    }
  }
);
