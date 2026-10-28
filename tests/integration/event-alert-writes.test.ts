import { beforeEach, expect, it } from 'vitest';
import prisma from '@/lib/prisma';
import { processEvent } from '@/lib/events';
import { createTestService, resetDatabase, testPrisma } from '../helpers/test-db';

let measuring = false;
let inserts = 0;
let updates = 0;
prisma.$on('query', event => {
  if (!measuring) return;
  const query = event.query.trimStart();
  if (query.startsWith('INSERT INTO "public"."Alert" ') || query.startsWith('INSERT INTO "Alert" '))
    inserts++;
  if (query.startsWith('UPDATE "public"."Alert" ') || query.startsWith('UPDATE "Alert" '))
    updates++;
});

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  measuring = false;
  await resetDatabase();
  inserts = 0;
  updates = 0;
});

it('writes each normal lifecycle alert with its final incident link in one insert', async () => {
  const service = await createTestService('Alert write budget');
  measuring = true;
  try {
    for (const event_action of ['trigger', 'trigger', 'acknowledge', 'resolve'] as const)
      await processEvent(
        {
          event_action,
          dedup_key: 'linked-alert',
          payload: {
            summary: 'Database latency',
            source: 'alert-write-test',
            severity: 'critical',
          },
        },
        service.id,
        'alert-write-test'
      );
  } finally {
    measuring = false;
  }
  const incident = await testPrisma.incident.findFirstOrThrow({ where: { serviceId: service.id } });
  expect(incident.status).toBe('RESOLVED');
  expect(await testPrisma.alert.count({ where: { incidentId: incident.id } })).toBe(4);
  expect(await testPrisma.alert.count({ where: { serviceId: service.id, incidentId: null } })).toBe(
    0
  );
  expect(inserts).toBe(4);
  expect(updates).toBe(0);
});

it('rolls back the new incident when inserting its linked alert fails', async () => {
  const service = await createTestService('Alert insertion rollback');
  await testPrisma.$executeRaw`
    ALTER TABLE "Alert" ADD CONSTRAINT certification_alert_write_fault
      CHECK (payload->>'summary' <> 'certification-alert-write-fault') NOT VALID
  `;
  try {
    await expect(
      processEvent(
        {
          event_action: 'trigger',
          dedup_key: 'alert-write-rollback',
          payload: {
            summary: 'certification-alert-write-fault',
            source: 'alert-write-test',
            severity: 'critical',
          },
        },
        service.id,
        'alert-write-test'
      )
    ).rejects.toThrow();
    expect(await testPrisma.incident.count({ where: { serviceId: service.id } })).toBe(0);
    expect(await testPrisma.alert.count({ where: { serviceId: service.id } })).toBe(0);
  } finally {
    await testPrisma.$executeRaw`ALTER TABLE "Alert" DROP CONSTRAINT certification_alert_write_fault`;
  }
});
