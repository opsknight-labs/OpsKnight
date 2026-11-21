import { PrismaClient } from '@prisma/client';
import { beforeEach, expect, it } from 'vitest';
import { backfillAlertShapes } from '@/lib/alerts/backfill';
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

it('backfills bounded pages without changing payloads, creation timestamps, incident or notification state', async () => {
  const service = await createTestService('Metadata backfill');
  const incident = await createTestIncident('Legacy errors', service.id);
  const at = new Date(Date.now() - 60000);
  const payload = {
    summary: 'Database errors on db-7',
    severity: 'critical',
    custom_details: { env: 'prod', resource: 'checkout', password: 'private-secret' },
  };
  await db.alert.createMany({
    data: Array.from({ length: 3 }, (_, i) => ({
      id: `legacy-shape-${i}`,
      createdAt: at,
      updatedAt: null,
      serviceId: service.id,
      incidentId: incident.id,
      payload,
    })),
  });
  const first = await backfillAlertShapes({ limit: 2 });
  expect(first).toMatchObject({ scanned: 2, updated: 2, skipped: 0, done: false });
  expect(first.after?.id).toBe('legacy-shape-1');
  const second = await backfillAlertShapes({ limit: 2, after: first.after! });
  expect(second).toMatchObject({ scanned: 1, updated: 1, done: true });
  const alerts = await db.alert.findMany();
  expect(
    alerts.every(
      row =>
        row.severity === 'critical' &&
        row.resourceKey === 'checkout' &&
        /^[a-f0-9]{32}$/.test(row.fingerprintHash ?? '')
    )
  ).toBe(true);
  expect(
    alerts.every(
      row => JSON.stringify(row.labels) === JSON.stringify({ env: 'prod', resource: 'checkout' })
    )
  ).toBe(true);
  expect(alerts.map(row => row.payload)).toEqual([payload, payload, payload]);
  expect(alerts.every(row => +row.createdAt === +at)).toBe(true);
  expect(await db.incident.findUniqueOrThrow({ where: { id: incident.id } })).toEqual(incident);
  expect(await db.backgroundJob.count()).toBe(0);
  expect(await backfillAlertShapes()).toMatchObject({ scanned: 0, updated: 0, done: true });
});

it('skips a concurrently edited source and safely normalizes it on the next pass', async () => {
  const service = await createTestService('Concurrent metadata edit');
  const alert = await db.alert.create({
    data: { serviceId: service.id, payload: { summary: 'Old warning', severity: 'warning' } },
  });
  const client = new PrismaClient();
  let edited = false;
  client.$use(async (params, next) => {
    const result: unknown = await next(params);
    if (params.model === 'Alert' && params.action === 'findMany' && !edited) {
      edited = true;
      await db.alert.update({
        where: { id: alert.id },
        data: { payload: { summary: 'New critical', severity: 'critical' } },
      });
    }
    return result;
  });
  try {
    expect(await backfillAlertShapes({}, client)).toMatchObject({
      scanned: 1,
      updated: 0,
      skipped: 1,
    });
    expect((await db.alert.findUniqueOrThrow({ where: { id: alert.id } })).severity).toBeNull();
    expect(await backfillAlertShapes({}, client)).toMatchObject({
      scanned: 1,
      updated: 1,
      skipped: 0,
    });
    expect(await db.alert.findUniqueOrThrow({ where: { id: alert.id } })).toMatchObject({
      severity: 'critical',
      payload: { summary: 'New critical' },
    });
  } finally {
    await client.$disconnect();
  }
});
