import { afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { processEvent } from '@/lib/events';
import { primePrePagingSnapshot } from '@/lib/intelligence/noise-controls';

afterAll(() => prisma.$disconnect());

/**
 * Flapping is decided only by the policy flapping control (noise-controls/evaluate.ts). With no noise
 * policy a key with a flapping history still pages: there is no fixed-threshold legacy path anymore.
 */
it('a trigger after rapid TRIGGERED/RESOLVED oscillation pages when no flapping policy is on', async () => {
  const url = new URL(process.env.DATABASE_URL!);
  expect(url.hostname).toBe('127.0.0.1');
  expect(url.pathname).toMatch(/^\/ingestion_test_/);
  const service = await prisma.service.create({ data: { name: `Flapping ${randomUUID()}` } });
  await primePrePagingSnapshot();
  const integrationId = 'flapping-history';
  const key = randomUUID();
  const now = Date.now();
  try {
    // Linked to an earlier, resolved incident so no alert reads as a buffered out-of-order resolve.
    const previous = await prisma.incident.create({
      data: { title: 'Disk flapping', serviceId: service.id, status: 'RESOLVED' },
    });
    await prisma.alert.createMany({
      data: Array.from({ length: 6 }, (_, i) => ({
        serviceId: service.id,
        dedupKey: `${integrationId}:${key}`,
        status: i % 2 ? 'RESOLVED' : 'TRIGGERED',
        createdAt: new Date(now - 10_000 - i * 1000),
        payload: {},
        incidentId: previous.id,
      })),
    });
    const result = await processEvent(
      {
        event_action: 'trigger',
        dedup_key: key,
        payload: { summary: 'Disk flapping', source: 'test', severity: 'critical' },
      },
      service.id,
      integrationId
    );
    expect(result.action).toBe('triggered');
    expect('incident' in result && result.incident?.status).toBe('OPEN');
  } finally {
    await prisma.alert.deleteMany({ where: { serviceId: service.id } });
    await prisma.incident.deleteMany({ where: { serviceId: service.id } });
    await prisma.service.delete({ where: { id: service.id } });
  }
});
