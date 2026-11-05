/**
 * POST /api/v2/incidents/{id}/escalate over REST, without MCP in front of it: the route's own
 * RBAC, scope, validation and Idempotency-Key handling. The MCP tool is covered in
 * tests/integration/mcp-curated-incident-actions.test.ts.
 */
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeAll, describe, expect, it } from 'vitest';
import { hashTokenV2 } from '@/lib/api-keys';
import type { AppRole } from '@/lib/authorization';
import { POST as escalate } from '@/app/api/v2/incidents/[id]/escalate/route';
import {
  createTestEscalationPolicy,
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

async function credential(role: AppRole, scopes = ['incidents:read', 'incidents:write']) {
  const user = await createTestUser({ role });
  const token = `ok_test_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  await db.apiKey.create({
    data: {
      name: 'escalate REST test',
      prefix: token.slice(0, 12),
      tokenHash: hashTokenV2(token),
      scopes,
      userId: user.id,
    },
  });
  return token;
}

function post(token: string, id: string, key?: string, query = '') {
  return escalate(
    new NextRequest(`http://localhost/api/v2/incidents/${id}/escalate${query}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, ...(key ? { 'idempotency-key': key } : {}) },
    }),
    { params: Promise.resolve({ id }) }
  );
}

const requests = (incidentId: string) =>
  db.auditLog.count({ where: { action: 'incident.escalation.requested', entityId: incidentId } });

let serviceId: string;
let admin: string;

beforeAll(async () => {
  await resetDatabase();
  const responder = await createTestUser({ role: 'USER', name: 'Paged responder' });
  const policy = await createTestEscalationPolicy('REST escalate policy', [
    { stepOrder: 0, delayMinutes: 0, targetType: 'USER', targetUserId: responder.id },
    { stepOrder: 1, delayMinutes: 10, targetType: 'USER', targetUserId: responder.id },
  ]);
  serviceId = (await createTestService('REST escalate', null, { escalationPolicyId: policy.id }))
    .id;
  admin = await credential('ADMIN');
}, 60000);

describe('POST /api/v2/incidents/{id}/escalate', () => {
  it('pages once, reports who, and replays the same key without paging again', async () => {
    const { id } = await createTestIncident('REST escalate', serviceId, { status: 'OPEN' });
    const key = `escalate-${randomUUID()}`;
    const first = await post(admin, id, key);
    expect(first.status).toBe(200);
    const body = (await first.json()).data;
    expect(body).toMatchObject({
      requested: true,
      escalated: true,
      paged: { stepIndex: 0, targetType: 'USER', targetName: 'Paged responder' },
      incident: { id, status: 'OPEN', escalation: { step: 1 } },
    });
    const replay = await post(admin, id, key);
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect((await replay.json()).data.paged).toEqual(body.paged);
    expect(await requests(id)).toBe(1);
  });

  it('refuses a key reused for another incident with 409, paging nobody', async () => {
    const first = await createTestIncident('REST escalate a', serviceId, { status: 'OPEN' });
    const second = await createTestIncident('REST escalate b', serviceId, { status: 'OPEN' });
    const key = `escalate-${randomUUID()}`;
    expect((await post(admin, first.id, key)).status).toBe(200);
    const conflict = await post(admin, second.id, key);
    expect(conflict.status).toBe(409);
    expect((await conflict.json()).code).toBe('IDEMPOTENCY_KEY_CONFLICT');
    expect(await requests(second.id)).toBe(0);
  });

  it('leaves an incident that is not OPEN alone', async () => {
    const { id } = await createTestIncident('REST escalate acked', serviceId, {
      status: 'ACKNOWLEDGED',
    });
    const response = await post(admin, id, `escalate-${randomUUID()}`);
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      requested: false,
      reason: 'INCIDENT_NOT_ESCALATABLE',
      escalated: false,
      paged: null,
    });
    expect(await requests(id)).toBe(0);
  });

  it('refuses a role without escalate authority and a key without incidents:write', async () => {
    const { id } = await createTestIncident('REST escalate denied', serviceId, { status: 'OPEN' });
    const user = await credential('USER');
    expect((await post(user, id, `escalate-${randomUUID()}`)).status).toBe(403);
    const readOnly = await credential('ADMIN', ['incidents:read']);
    expect((await post(readOnly, id, `escalate-${randomUUID()}`)).status).toBe(403);
    expect(await requests(id)).toBe(0);
  });

  it('validates the request: unknown query, an oversized key, a missing incident', async () => {
    const { id } = await createTestIncident('REST escalate invalid', serviceId, {
      status: 'OPEN',
    });
    expect((await post(admin, id, undefined, '?force=true')).status).toBe(400);
    expect((await post(admin, id, 'k'.repeat(201))).status).toBe(400);
    expect(await requests(id)).toBe(0);
    expect((await post(admin, 'missing-incident', `escalate-${randomUUID()}`)).status).toBe(404);
  });
});
