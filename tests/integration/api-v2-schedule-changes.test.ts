import { beforeEach, expect, it } from 'vitest';
import { GET } from '@/app/api/v2/schedules/[id]/changes/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});

it('limits change history to the exact schedule and redacts sensitive details', async () => {
  const admin = await createV2Credential(['schedules:write']);
  const reader = await createV2Credential(['schedules:read']);
  const schedule = await db.onCallSchedule.create({ data: { name: 'Change schedule' } });
  const other = await db.onCallSchedule.create({ data: { name: 'Other change schedule' } });
  await db.auditLog.create({
    data: {
      action: 'schedule.layer.created',
      entityType: 'SCHEDULE',
      entityId: schedule.id,
      details: { layerId: 'test-layer', password: 'a-private-value' },
    },
  });
  await db.auditLog.create({
    data: {
      action: 'schedule.layer.deleted',
      entityType: 'SCHEDULE',
      entityId: other.id,
    },
  });
  const path = `/schedules/${schedule.id}/changes`;
  expect((await invokeV2(GET, reader.token, 'GET', path, { id: schedule.id })).status).toBe(403);
  const response = await invokeV2(GET, admin.token, 'GET', path, { id: schedule.id });
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.data).toHaveLength(1);
  expect(result.data[0].action).toBe('schedule.layer.created');
  expect(JSON.stringify(result)).not.toContain('a-private-value');
  expect(JSON.stringify(result)).not.toContain(other.id);
});
