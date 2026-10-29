import { beforeEach, expect, it } from 'vitest';
import { GET } from '@/app/api/v2/schedules/[id]/dependencies/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});

it('shows exact escalation dependencies to schedule administrators only', async () => {
  const admin = await createV2Credential(['schedules:write']);
  const reader = await createV2Credential(['schedules:read']);
  const schedule = await db.onCallSchedule.create({ data: { name: 'Dependency schedule' } });
  const other = await db.onCallSchedule.create({ data: { name: 'Other schedule' } });
  const policy = await db.escalationPolicy.create({ data: { name: 'Dependency policy' } });
  const step = await db.escalationRule.create({ data: {
    policyId: policy.id, stepOrder: 1, targetType: 'SCHEDULE', targetScheduleId: schedule.id,
  } });
  await db.escalationRule.create({ data: {
    policyId: policy.id, stepOrder: 2, targetType: 'SCHEDULE', targetScheduleId: other.id,
  } });
  const path = `/schedules/${schedule.id}/dependencies`;
  expect((await invokeV2(GET, reader.token, 'GET', path, { id: schedule.id })).status).toBe(403);
  const response = await invokeV2(GET, admin.token, 'GET', path, { id: schedule.id });
  expect(response.status).toBe(200);
  const data = (await response.json()).data;
  expect(data).toMatchObject({ scheduleId: schedule.id, total: 1, truncated: false });
  expect(data.escalationSteps).toEqual([{
    id: step.id, policyId: policy.id, policyName: policy.name, policyArchived: false, stepOrder: 1,
  }]);
  expect(JSON.stringify(data)).not.toContain(other.id);
});
