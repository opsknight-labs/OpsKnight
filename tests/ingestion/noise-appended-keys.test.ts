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
import { disconnectNoiseLookupClient } from '@/lib/intelligence/noise-controls/lookup-client';

/**
 * Content dedup appends alerts with other dedup keys onto an open incident. Their resolves must find that
 * incident, and it resolves only once every alert key on it is clear.
 */

const services: string[] = [];
const integrationId = 'appended-keys';

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

async function service(definition: Record<string, unknown> | null) {
  const created = await prisma.service.create({ data: { name: `Appended ${randomUUID()}` } });
  services.push(created.id);
  if (definition)
    await prisma.noiseControlPolicy.create({
      data: {
        scopeKey: `service:${created.id}`,
        serviceId: created.id,
        mode: 'ON',
        definition: { schemaVersion: 1, ...definition } as Prisma.InputJsonObject,
      },
    });
  await primePrePagingSnapshot();
  return created.id;
}

const send = (
  serviceId: string,
  event_action: EventPayload['event_action'],
  dedup_key: string,
  summary: string
) =>
  processEvent(
    { event_action, dedup_key, payload: { summary, source: 'test', severity: 'error' } },
    serviceId,
    integrationId
  );

const status = async (id: string) =>
  (await prisma.incident.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

it('an incident with an appended key resolves only after both keys clear, in either order', async () => {
  const serviceId = await service({ contentDedup: { enabled: true, windowSeconds: 600 } });
  for (const firstResolved of ['own', 'appended'] as const) {
    const summary = `Checkout 5xx ${randomUUID()}`;
    const own = randomUUID();
    const appended = randomUUID();
    const opened = await send(serviceId, 'trigger', own, summary);
    if (!('incident' in opened) || !opened.incident) throw new Error('expected an incident');
    const incidentId = opened.incident.id;
    const second = await send(serviceId, 'trigger', appended, summary);
    expect(second.action).toBe('deduplicated');
    expect('incident' in second && second.incident?.id).toBe(incidentId);

    const [first, last] = firstResolved === 'own' ? [own, appended] : [appended, own];
    const partial = await send(serviceId, 'resolve', first, summary);
    expect('incident' in partial && partial.incident?.id).toBe(incidentId);
    expect(await status(incidentId)).toBe('OPEN');

    const done = await send(serviceId, 'resolve', last, summary);
    expect(done.action).toBe('resolved');
    expect(await status(incidentId)).toBe('RESOLVED');
  }
});

it('a single-key incident resolves on its own resolve, as before', async () => {
  const serviceId = await service(null);
  const key = randomUUID();
  const opened = await send(serviceId, 'trigger', key, 'Disk full');
  if (!('incident' in opened) || !opened.incident) throw new Error('expected an incident');
  await send(serviceId, 'trigger', key, 'Disk full');
  const resolved = await send(serviceId, 'resolve', key, 'Disk full');
  expect(resolved.action).toBe('resolved');
  expect(await status(opened.incident.id)).toBe('RESOLVED');
});

it('an appended key that later opens its own incident no longer holds the original open', async () => {
  const serviceId = await service({ contentDedup: { enabled: true, windowSeconds: 600 } });
  for (const firstResolved of ['own', 'appended'] as const) {
    const summary = `Checkout 5xx ${randomUUID()}`;
    const own = randomUUID();
    const appended = randomUUID();
    const opened = await send(serviceId, 'trigger', own, summary);
    if (!('incident' in opened) || !opened.incident) throw new Error('expected an incident');
    const incidentId = opened.incident.id;
    expect((await send(serviceId, 'trigger', appended, summary)).action).toBe('deduplicated');
    // Different content: the appended key now opens an incident of its own.
    const split = await send(serviceId, 'trigger', appended, `Payments down ${randomUUID()}`);
    if (!('incident' in split) || !split.incident) throw new Error('expected an incident');
    expect(split.incident.id).not.toBe(incidentId);

    for (const key of firstResolved === 'own' ? [own, appended] : [appended, own])
      await send(serviceId, 'resolve', key, summary);
    expect(await status(incidentId)).toBe('RESOLVED');
    expect(await status(split.incident.id)).toBe('RESOLVED');
  }
});
