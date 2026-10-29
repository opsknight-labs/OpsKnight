import { beforeEach, expect, it } from 'vitest';
import { POST } from '@/app/api/v2/schedules/[id]/coverage/preview/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

it('simulates a replacement with the canonical engine without persisting it', async () => {
  const manager = await createV2Credential(['schedules:write']);
  const existing = await createTestUser();
  const proposed = await createTestUser();
  const schedule = await db.onCallSchedule.create({
    data: { name: 'Preview schedule', timeZone: 'UTC' },
  });
  const layer = await db.onCallLayer.create({
    data: {
      scheduleId: schedule.id,
      name: 'Current',
      start: new Date('2026-11-01T00:00:00.000Z'),
      rotationLengthHours: 24,
      users: { create: [{ userId: existing.id, position: 1 }] },
    },
  });
  const revision = (await db.onCallSchedule.findUniqueOrThrow({ where: { id: schedule.id } }))
    .revision;
  const path = `/schedules/${schedule.id}/coverage/preview`;
  const request = () =>
    invokeV2(
      POST,
      manager.token,
      'POST',
      path,
      { id: schedule.id },
      {
        start: '2026-11-01T00:00:00.000Z',
        end: '2026-11-02T00:00:00.000Z',
        layerId: layer.id,
        proposedLayer: {
          name: 'Proposed',
          start: '2026-11-01T00:00:00.000Z',
          end: null,
          rotationLengthHours: 24,
          shiftLengthHours: null,
          restrictions: null,
          responderIds: [proposed.id],
        },
      },
      { 'If-Match': `"${revision}"` }
    );
  const response = await request();
  expect(response.status).toBe(200);
  const data = (await response.json()).data;
  expect(data).toMatchObject({ scheduleId: schedule.id, revision, advisory: true, gaps: [] });
  expect(data.shifts.length).toBeGreaterThan(0);
  expect(data.shifts.every((shift: { userId: string }) => shift.userId === proposed.id)).toBe(true);
  expect(JSON.stringify(data)).not.toContain(proposed.email);
  expect((await db.onCallLayer.findUniqueOrThrow({ where: { id: layer.id } })).name).toBe(
    'Current'
  );
  expect((await db.onCallSchedule.findUniqueOrThrow({ where: { id: schedule.id } })).revision).toBe(
    revision
  );
  await db.onCallLayer.update({ where: { id: layer.id }, data: { name: 'Changed concurrently' } });
  expect((await request()).status).toBe(412);
});

it('denies credentials without schedule administration and rejects oversized windows', async () => {
  const manager = await createV2Credential(['schedules:write']);
  const reader = await createV2Credential(['schedules:read']);
  const schedule = await db.onCallSchedule.create({ data: { name: 'Preview denial' } });
  const path = `/schedules/${schedule.id}/coverage/preview`;
  const input = {
    start: '2026-11-01T00:00:00.000Z',
    end: '2026-11-09T00:00:00.000Z',
    layerId: null,
    proposedLayer: {
      name: 'New',
      start: '2026-11-01T00:00:00.000Z',
      end: null,
      rotationLengthHours: 24,
      shiftLengthHours: null,
      restrictions: null,
      responderIds: [],
    },
  };
  const headers = { 'If-Match': `"${schedule.revision}"` };
  expect(
    (await invokeV2(POST, reader.token, 'POST', path, { id: schedule.id }, input, headers)).status
  ).toBe(403);
  expect(
    (await invokeV2(POST, manager.token, 'POST', path, { id: schedule.id }, input, headers)).status
  ).toBe(400);
});
