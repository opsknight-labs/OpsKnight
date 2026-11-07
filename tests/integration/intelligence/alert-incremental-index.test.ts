import { PrismaClient } from '@prisma/client';
import { beforeEach, expect, it } from 'vitest';
import { indexIncident } from '@/lib/intelligence/jobs/indexer';
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

it('reads only new/edited payloads in a 5k-alert incident and repairs labels, ordering and deletion', async () => {
  const service = await createTestService('Incremental indexing');
  const incident = await createTestIncident('Pool exhausted', service.id);
  const at = Date.now() - 60000;
  await db.alert.createMany({
    data: Array.from({ length: 5000 }, (_, i) => ({
      id: `incremental-alert-${i.toString().padStart(5, '0')}`,
      incidentId: incident.id,
      serviceId: service.id,
      createdAt: new Date(at + i),
      payload: { summary: 'Pool exhausted', custom_details: { env: 'prod' } },
    })),
  });
  const client = new PrismaClient();
  let payloadRowsRead = 0;
  client.$use(async (params, next) => {
    const rows: unknown = await next(params);
    if (params.model === 'Alert' && params.action === 'findMany' && Array.isArray(rows))
      payloadRowsRead += rows.length;
    return rows;
  });
  const index = (force = false) =>
    client.$transaction(tx => indexIncident(incident.id, tx, { force }), { timeout: 30000 });
  try {
    await index();
    expect(payloadRowsRead).toBe(5000);
    await db.alert.create({
      data: {
        incidentId: incident.id,
        serviceId: service.id,
        payload: { summary: 'Pool exhausted', custom_details: { region: 'eu-west-1' } },
      },
    });
    payloadRowsRead = 0;
    expect(await index()).toBe('indexed');
    expect(payloadRowsRead).toBe(1);
    payloadRowsRead = 0;
    expect(await index()).toBe('unchanged');
    expect(payloadRowsRead).toBe(0);
    await new Promise(resolve => setTimeout(resolve, 2));
    await db.alert.update({
      where: { id: 'incremental-alert-00000' },
      data: { payload: { summary: 'Pool changed', custom_details: { env: 'stage' } } },
    });
    payloadRowsRead = 0;
    expect(await index()).toBe('indexed');
    expect(payloadRowsRead).toBe(1);
    expect(
      (await db.incidentFingerprint.findUniqueOrThrow({ where: { incidentId: incident.id } }))
        .labels
    ).toEqual({ env: 'stage', region: 'eu-west-1' });
    await db.alert.delete({ where: { id: 'incremental-alert-00000' } });
    payloadRowsRead = 0;
    expect(await index()).toBe('indexed');
    expect(payloadRowsRead).toBe(0);
    expect(
      (await db.incidentFingerprint.findUniqueOrThrow({ where: { incidentId: incident.id } }))
        .labels
    ).toEqual({ env: 'prod', region: 'eu-west-1' });
    await db.alert.create({
      data: {
        incidentId: incident.id,
        serviceId: service.id,
        createdAt: new Date(at - 1000),
        payload: { summary: 'Pool exhausted', custom_details: { env: 'legacy' } },
      },
    });
    payloadRowsRead = 0;
    expect(await index()).toBe('indexed');
    expect(payloadRowsRead).toBe(1);
    const before = await db.incidentFingerprint.findUniqueOrThrow({
      where: { incidentId: incident.id },
    });
    expect(before.labels).toEqual({ env: 'legacy', region: 'eu-west-1' });
    payloadRowsRead = 0;
    expect(await index(true)).toBe('indexed');
    expect(payloadRowsRead).toBe(5001);
    expect(
      (await db.incidentFingerprint.findUniqueOrThrow({ where: { incidentId: incident.id } }))
        .analysisInputHash
    ).toBe(before.analysisInputHash);
  } finally {
    await client.$disconnect();
  }
});

it('discovers the first ORM edit to a legacy null timestamp and repairs an out-of-band old insertion', async () => {
  const service = await createTestService('Legacy alert cursor');
  const incident = await createTestIncident('Errors', service.id);
  const alert = await db.alert.create({
    data: {
      incidentId: incident.id,
      serviceId: service.id,
      updatedAt: null,
      payload: { summary: 'Errors', custom_details: { env: 'prod' } },
    },
  });
  const index = () => db.$transaction(tx => indexIncident(incident.id, tx));
  await index();
  expect(
    (await db.incidentFingerprint.findUniqueOrThrow({ where: { incidentId: incident.id } }))
      .lastModifiedAlertAt
  ).toBeNull();
  await db.alert.update({
    where: { id: alert.id },
    data: { payload: { summary: 'Errors', custom_details: { env: 'stage' } } },
  });
  expect(await index()).toBe('indexed');
  await db.alert.create({
    data: {
      incidentId: incident.id,
      serviceId: service.id,
      updatedAt: null,
      createdAt: new Date(+alert.createdAt - 1000),
      payload: { summary: 'Errors', custom_details: { env: 'older' } },
    },
  });
  expect(await index()).toBe('indexed');
  expect(
    (await db.incidentFingerprint.findUniqueOrThrow({ where: { incidentId: incident.id } })).labels
  ).toEqual({ env: 'older' });
  expect(await db.alertFingerprint.count({ where: { incidentId: incident.id } })).toBe(2);
});
