import { beforeEach, expect, it } from 'vitest';
import {
  OBSERVE_SOURCE_PAGE_SIZE,
  observeDependencyPass,
} from '@/lib/intelligence/dependencies/observer';
import { purgeExpiredIntelligenceData } from '@/lib/intelligence/jobs/retention';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  createTestIncident,
  createTestService,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

it('resumes bounded bootstrap pages before suggesting edges, then processes only newly reached buckets', async () => {
  const upstream = await createTestService('Incremental upstream');
  const downstream = await createTestService('Incremental downstream');
  const filler = await createTestService('Unrelated volume');
  const now = new Date();
  const base = +now - 3 * 86400000;
  const signalRows = Array.from({ length: 6 }, (_, i) => [
    { title: `Up ${i}`, serviceId: upstream.id, createdAt: new Date(base + i * 3600000) },
    {
      title: `Down ${i}`,
      serviceId: downstream.id,
      createdAt: new Date(base + i * 3600000 + 120000),
    },
  ]).flat();
  await db.incident.createMany({
    data: [
      ...signalRows,
      ...Array.from({ length: OBSERVE_SOURCE_PAGE_SIZE + 5 - signalRows.length }, (_, i) => ({
        id: `observer-fill-${i.toString().padStart(5, '0')}`,
        title: 'Unrelated noise',
        serviceId: filler.id,
        createdAt: new Date(+now - 2 * 86400000),
      })),
    ],
  });
  const settings = { maxDbMs: 30000 };
  expect(await observeDependencyPass(settings, now)).toEqual({ suggestions: 0, more: true });
  expect(await db.serviceDependency.count()).toBe(0);
  const firstCursor = await db.intelligenceCursor.findUniqueOrThrow({
    where: { name: 'dependency-observation' },
  });
  expect(await observeDependencyPass(settings, now)).toEqual({ suggestions: 1, more: false });
  const caughtUp = await db.intelligenceCursor.findUniqueOrThrow({
    where: { name: 'dependency-observation' },
  });
  expect(caughtUp.lastId).not.toBe(firstCursor.lastId);
  const buckets = await db.dependencyObservationBucket.findMany({
    orderBy: [{ bucket: 'asc' }, { serviceId: 'asc' }],
  });
  expect(buckets).toHaveLength(13);
  expect(await observeDependencyPass(settings, now)).toEqual({ suggestions: 0, more: false });
  expect(
    await db.dependencyObservationBucket.findMany({
      orderBy: [{ bucket: 'asc' }, { serviceId: 'asc' }],
    })
  ).toEqual(buckets);
  await createTestIncident('New upstream problem', upstream.id, { createdAt: now });
  expect(await observeDependencyPass(settings, new Date(+now + 60000))).toEqual({
    suggestions: 0,
    more: false,
  });
  expect(await db.dependencyObservationBucket.count()).toBe(14);
  const edge = await db.serviceDependency.findFirstOrThrow();
  expect(edge).toMatchObject({
    upstreamServiceId: upstream.id,
    downstreamServiceId: downstream.id,
    status: 'SUGGESTED',
  });
});

it('honors physical bucket retention even when Intelligence is disabled', async () => {
  const service = await createTestService('Retained observation');
  const now = new Date();
  await db.dependencyObservationBucket.createMany({
    data: [
      {
        serviceId: service.id,
        bucket: new Date(+now - 31 * 86400000),
        firstIncidentAt: new Date(+now - 31 * 86400000),
      },
      {
        serviceId: service.id,
        bucket: new Date(+now - 86400000),
        firstIncidentAt: new Date(+now - 86400000),
      },
    ],
  });
  const result = await purgeExpiredIntelligenceData(
    { ...INTELLIGENCE_SETTINGS_DEFAULTS, maxDbMs: 30000 },
    { now, batchSize: 10 }
  );
  expect(result.dependencyObservations).toBe(1);
  expect(await db.dependencyObservationBucket.count()).toBe(1);
});
