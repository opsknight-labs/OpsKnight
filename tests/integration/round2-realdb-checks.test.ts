import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';
import { pseudonymiseSubjectIncidentText } from '@/lib/privacy/erasure/audit-pseudonymise';
import { assertApiKeyCapacity, MAX_ACTIVE_API_KEYS_PER_USER } from '@/lib/api-key-capacity';
import { cleanupExpiredSessions } from '@/lib/session-registry';

// Real-database checks for code that runs raw SQL or relies on row locks, which the unit tests mock.
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('erasure of incident free text', () => {
  it("replaces the subject's identifiers in their notes and in timeline entries naming them, once", async () => {
    const subject = await createTestUser({ email: 'alice@example.com', name: 'Alice Wonder' });
    const other = await createTestUser({ email: 'bob@example.com', name: 'Bob Builder' });
    const service = await createTestService('Erasure service');
    const incident = await createTestIncident('Erasure incident', service.id);
    const own = await db.incidentNote.create({
      data: {
        incidentId: incident.id,
        userId: subject.id,
        content: 'Alice Wonder (alice@example.com) restarted the pod',
      },
    });
    const others = await db.incidentNote.create({
      data: { incidentId: incident.id, userId: other.id, content: 'Bob says all is well' },
    });
    const named = await db.incidentEvent.create({
      data: {
        incidentId: incident.id,
        type: 'COMMENT',
        message: 'Note added via Slack ChatOps by Alice Wonder:\nrestarted',
      },
    });
    // An incident the subject never touched: someone else sharing the display name.
    const otherIncident = await createTestIncident('Other incident', service.id);
    const sameName = await db.incidentEvent.create({
      data: {
        incidentId: otherIncident.id,
        type: 'COMMENT',
        message: 'Note added via Slack ChatOps by Alice Wonder:\nrestarted',
      },
    });
    const unrelated = await db.incidentEvent.create({
      data: { incidentId: incident.id, type: 'COMMENT', message: 'Unrelated timeline entry' },
    });

    const identity = {
      id: subject.id,
      email: subject.email,
      name: subject.name,
      phoneNumber: null,
    };
    const first = await db.$transaction(tx => pseudonymiseSubjectIncidentText(tx, identity));
    expect(first).toEqual({ notes: 1, events: 1, truncated: false });

    expect((await db.incidentNote.findUniqueOrThrow({ where: { id: own.id } })).content).toBe(
      '[erased] ([erased]) restarted the pod'
    );
    expect((await db.incidentNote.findUniqueOrThrow({ where: { id: others.id } })).content).toBe(
      'Bob says all is well'
    );
    expect((await db.incidentEvent.findUniqueOrThrow({ where: { id: named.id } })).message).toBe(
      'Note added via Slack ChatOps by [erased]:\nrestarted'
    );
    expect((await db.incidentEvent.findUniqueOrThrow({ where: { id: sameName.id } })).message).toBe(
      'Note added via Slack ChatOps by Alice Wonder:\nrestarted'
    );
    expect((await db.incidentEvent.findUniqueOrThrow({ where: { id: unrelated.id } })).message).toBe(
      'Unrelated timeline entry'
    );

    const second = await db.$transaction(tx => pseudonymiseSubjectIncidentText(tx, identity));
    expect(second).toEqual({ notes: 0, events: 0, truncated: false });
  });
});

describe('active API key cap', () => {
  it('refuses the 26th active key and ignores revoked and expired ones', async () => {
    const user = await createTestUser({ role: 'RESPONDER' });
    const keys = Array.from({ length: MAX_ACTIVE_API_KEYS_PER_USER }, (_unused, index) => ({
      name: `key-${index}`,
      prefix: `ok_${index}`,
      tokenHash: `hash-${index}`,
      scopes: ['incidents:read'],
      userId: user.id,
    }));
    await db.apiKey.createMany({ data: keys });

    await expect(db.$transaction(tx => assertApiKeyCapacity(tx, user.id))).rejects.toMatchObject({
      code: 'API_KEY_LIMIT_REACHED',
    });

    // A revoked key and an expired key free their slots.
    await db.apiKey.updateMany({ where: { name: 'key-0' }, data: { revokedAt: new Date() } });
    await db.apiKey.updateMany({
      where: { name: 'key-1' },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(db.$transaction(tx => assertApiKeyCapacity(tx, user.id))).resolves.toBeUndefined();
  });
});

describe('session registry pruning', () => {
  it('drops old active records and expired tombstones, keeps the rest', async () => {
    const user = await createTestUser();
    const day = 24 * 60 * 60 * 1000;
    const row = (
      deviceId: string,
      platform: string,
      ageDays: number,
      token = 'plain-token'
    ) => ({
      userId: user.id,
      deviceId,
      platform,
      token,
      createdAt: new Date(Date.now() - ageDays * day),
    });
    const tombstone = (expiresInDays: number) =>
      JSON.stringify({
        v: 2,
        digest: 'digest',
        issuedUnderPolicyVersion: null,
        expiresAt: new Date(Date.now() + expiresInDays * day).toISOString(),
      });
    await db.userDevice.createMany({
      data: [
        row('old-active', 'session:web', 101),
        row('fresh-active', 'session:web', 1),
        row('expired-tombstone', 'session:REVOKED:web', 120, tombstone(-3)),
        row('live-tombstone', 'session:REVOKED:web', 5, tombstone(3)),
        row('other-device', 'ios', 400),
      ],
    });

    const deleted = await cleanupExpiredSessions();

    expect(deleted).toBe(2);
    const left = (await db.userDevice.findMany({ select: { deviceId: true } }))
      .map(device => device.deviceId)
      .sort();
    expect(left).toEqual(['fresh-active', 'live-tombstone', 'other-device']);
  });
});
