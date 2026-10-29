import { beforeEach, expect, it } from 'vitest';
import { DELETE as cancelOverride } from '@/app/api/v2/schedules/[id]/overrides/[overrideId]/route';
import { GET as getCoverage } from '@/app/api/v2/schedules/[id]/coverage/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

it('calculates one schedule through the canonical engine and hides it from unrelated readers', async () => {
  const admin = await createV2Credential(['schedules:read']);
  const outsider = await createV2Credential(['schedules:read'], 'USER');
  const schedule = await db.onCallSchedule.create({
    data: { name: 'Coverage test', timeZone: 'UTC' },
  });
  await db.onCallLayer.create({
    data: {
      scheduleId: schedule.id,
      name: 'Primary',
      start: new Date('2026-11-01T00:00:00.000Z'),
      rotationLengthHours: 24,
      users: { create: [{ userId: admin.user.id, position: 1 }] },
    },
  });
  const path = `/schedules/${schedule.id}/coverage?start=2026-11-01T00:00:00.000Z&end=2026-11-02T00:00:00.000Z`;
  const coverage = await invokeV2(getCoverage, admin.token, 'GET', path, { id: schedule.id });
  expect(coverage.status).toBe(200);
  const data = (await coverage.json()).data;
  expect(data.shifts.length).toBeGreaterThan(0);
  expect(data.gaps).toEqual([]);
  expect(data.shifts.every((shift: { userId: string }) => shift.userId === admin.user.id)).toBe(
    true
  );
  expect(
    (await invokeV2(getCoverage, outsider.token, 'GET', path, { id: schedule.id })).status
  ).toBe(404);

  const tooLong = `/schedules/${schedule.id}/coverage?start=2026-11-01T00:00:00.000Z&end=2026-11-09T00:00:00.000Z`;
  expect(
    (await invokeV2(getCoverage, admin.token, 'GET', tooLong, { id: schedule.id })).status
  ).toBe(400);
});

it('cancels once, replays safely, and rejects a new cancellation without another audit', async () => {
  const admin = await createV2Credential(['schedules:write']);
  const schedule = await db.onCallSchedule.create({ data: { name: 'Cancellation test' } });
  const override = await db.onCallOverride.create({
    data: {
      scheduleId: schedule.id,
      userId: admin.user.id,
      start: new Date('2026-11-01T00:00:00.000Z'),
      end: new Date('2026-11-01T08:00:00.000Z'),
    },
  });
  const path = `/schedules/${schedule.id}/overrides/${override.id}`;
  const params = { id: schedule.id, overrideId: override.id };
  const unauthorized = await createV2Credential(['schedules:write'], 'USER');
  expect(
    (
      await invokeV2(cancelOverride, unauthorized.token, 'DELETE', path, params, undefined, {
        'Idempotency-Key': 'cancel-unauthorized',
      })
    ).status
  ).toBe(403);
  expect(await db.onCallOverride.count({ where: { id: override.id } })).toBe(1);
  const first = await invokeV2(cancelOverride, admin.token, 'DELETE', path, params, undefined, {
    'Idempotency-Key': 'cancel-override-1',
  });
  expect(first.status).toBe(200);
  expect((await first.json()).data).toEqual({ id: override.id, cancelled: true });
  const replay = await invokeV2(cancelOverride, admin.token, 'DELETE', path, params, undefined, {
    'Idempotency-Key': 'cancel-override-1',
  });
  expect(replay.status).toBe(200);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  const second = await invokeV2(cancelOverride, admin.token, 'DELETE', path, params, undefined, {
    'Idempotency-Key': 'cancel-override-2',
  });
  expect(second.status).toBe(404);
  expect(await db.onCallOverride.count({ where: { id: override.id } })).toBe(0);
  expect(await db.auditLog.count({ where: { action: 'schedule.override.deleted' } })).toBe(1);
});
