import { beforeEach, expect, it } from 'vitest';
import { GET, PUT } from '@/app/api/v2/settings/incident-sla/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

const path = '/settings/incident-sla';
const body = {
  baseAckTargetMs: 300_000,
  baseResolveTargetMs: 3_600_000,
  rules: [{ priority: 'P1', ackTargetMs: 60_000, resolveTargetMs: 600_000 }],
};

it('creates an immutable workspace SLA version with conditional replay and credential audit', async () => {
  const admin = await createV2Credential(['response-policy:read', 'response-policy:write']);
  const before = await invokeV2(GET, admin.token, 'GET', path, {});
  expect(before.status).toBe(200);
  expect(before.headers.get('etag')).toBe('"1"');
  const put = (key: string) => invokeV2(PUT, admin.token, 'PUT', path, {}, body, {
    'If-Match': '"1"', 'Idempotency-Key': key,
  });
  const first = await put('workspace-sla-1');
  expect(first.status).toBe(200);
  expect(first.headers.get('etag')).toBe('"2"');
  expect((await first.json()).data.policy).toMatchObject({
    scopeKey: 'workspace', version: 2, inheritWorkspace: false,
  });
  const replay = await put('workspace-sla-1');
  expect(replay.status).toBe(200);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await put('workspace-sla-2')).status).toBe(412);
  expect(await db.incidentSlaPolicy.count({ where: { scopeKey: 'workspace' } })).toBe(2);
  const audit = await db.auditLog.findFirstOrThrow({ where: { action: 'incident_sla.policy.version_created' } });
  expect((audit.details as { metadata: { apiClientId: string } }).metadata.apiClientId).toBe(admin.key.id);
});

it('denies the wrong scope and invalid target pairs', async () => {
  const writer = await createV2Credential(['response-policy:write']);
  const unrelated = await createV2Credential(['services:write']);
  const headers = { 'If-Match': '"1"', 'Idempotency-Key': 'workspace-sla-denied' };
  expect((await invokeV2(PUT, unrelated.token, 'PUT', path, {}, body, headers)).status).toBe(403);
  expect((await invokeV2(PUT, writer.token, 'PUT', path, {}, {
    ...body, baseAckTargetMs: 4_000_000,
  }, headers)).status).toBe(400);
  expect(await db.incidentSlaPolicy.count({ where: { scopeKey: 'workspace' } })).toBe(1);
});
