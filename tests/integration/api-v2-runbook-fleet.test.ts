import { setTimeout as delay } from 'node:timers/promises';
import { claimAgentAttempt } from '@/lib/runbooks/agent-claims';
import { revokeRunbookAgent } from '@/lib/runbooks/fleet-commands';
import { createHash } from 'node:crypto';
import { beforeEach, expect, it } from 'vitest';
import { POST as enroll } from '@/app/api/v2/runbooks/agent-enrollments/route';
import { GET as enrollmentStatus } from '@/app/api/v2/runbooks/agent-enrollments/[id]/route';
import { GET as listAgents } from '@/app/api/v2/runbooks/agents/route';
import { GET as getAgent } from '@/app/api/v2/runbooks/agents/[id]/route';
import { GET as policyStatus } from '@/app/api/v2/runbooks/agents/[id]/policy-status/route';
import { POST as revoke } from '@/app/api/v2/runbooks/agents/[id]/revoke/route';
import { consumeEnrollmentToken } from '@/lib/runbooks/agent-auth';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { testPrisma as db, resetDatabase } from '../helpers/test-db';

const scopes = ['runbook-agents:read', 'runbook-agents:enroll', 'runbook-agents:revoke'];
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
const issue = (token: string, key = 'enroll-once', name = 'Fleet administrator fixture') =>
  invokeV2(
    enroll,
    token,
    'POST',
    '/runbooks/agent-enrollments',
    {},
    { name },
    { 'Idempotency-Key': key }
  );
it('returns enrollment material once, persists only metadata, and audits with API attribution', async () => {
  const credential = await createV2Credential(scopes);
  const first = await issue(credential.token);
  expect(first.status).toBe(201);
  expect(first.headers.get('cache-control')).toBe('no-store');
  const body = (await first.json()).data;
  expect(body.token.length).toBeGreaterThan(30);
  const row = await db.runbookAgent.findUniqueOrThrow({ where: { id: body.id } });
  expect(row.enrollmentTokenHash).toBe(createHash('sha256').update(body.token).digest('hex'));
  const receipts = await db.backgroundJob.findMany();
  expect(JSON.stringify(receipts)).not.toContain(body.token);
  const replay = await issue(credential.token);
  expect(replay.status).toBe(201);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await replay.json()).data).toMatchObject({ id: body.id, token: null });
  expect(await db.runbookAgent.count()).toBe(1);
  const audit = await db.auditLog.findMany({
    where: { action: 'runbook.agent.enrollment.created' },
  });
  expect(audit).toHaveLength(1);
  expect(audit[0]).toMatchObject({
    actorId: credential.user.id,
    details: expect.objectContaining({
      source: 'API',
      metadata: expect.objectContaining({ apiClientId: credential.key.id }),
    }),
  });
  expect((await issue(credential.token, 'enroll-once', 'Changed name')).status).toBe(409);
});
it('concurrent enrollment retries create one identity and disclose material to one response', async () => {
  const credential = await createV2Credential(scopes);
  const responses = await Promise.all(Array.from({ length: 3 }, () => issue(credential.token)));
  expect(responses.map(r => r.status)).toEqual([201, 201, 201]);
  const bodies = await Promise.all(responses.map(async r => (await r.json()).data));
  expect(new Set(bodies.map(b => b.id)).size).toBe(1);
  expect(bodies.filter(b => b.token !== null)).toHaveLength(1);
  expect(await db.runbookAgent.count()).toBe(1);
});
it('fleet projections and enrollment status exclude credentials and raw diagnostic content', async () => {
  const credential = await createV2Credential(scopes);
  const body = (await (await issue(credential.token)).json()).data;
  await db.runbookAgent.update({
    where: { id: body.id },
    data: {
      lastError: 'private-diagnostic-value',
      capabilityReport: [{ reason: 'private-diagnostic-value' }],
      capabilities: ['RUNBOOK_BASH', 'private-diagnostic-value'],
      publicKey: 'private-diagnostic-value',
    },
  });
  for (const [handler, path, params] of [
    [listAgents, '/runbooks/agents', {}],
    [getAgent, `/runbooks/agents/${body.id}`, { id: body.id }],
    [policyStatus, `/runbooks/agents/${body.id}/policy-status`, { id: body.id }],
    [enrollmentStatus, `/runbooks/agent-enrollments/${body.id}`, { id: body.id }],
  ] as const) {
    const response = await invokeV2(handler, credential.token, 'GET', path, params);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).not.toContain(body.token);
    expect(text).not.toContain('enrollmentTokenHash');
    expect(text).not.toContain('private-diagnostic-value');
    expect(text).not.toContain('publicKey');
  }
});
it('revocation is terminal, invalidates enrollment, and audits once for concurrent distinct keys', async () => {
  const credential = await createV2Credential(scopes);
  const body = (await (await issue(credential.token)).json()).data;
  const responses = await Promise.all(
    ['cancel-1', 'cancel-2', 'cancel-3'].map(key =>
      invokeV2(
        revoke,
        credential.token,
        'POST',
        `/runbooks/agents/${body.id}/revoke`,
        { id: body.id },
        {},
        { 'Idempotency-Key': key }
      )
    )
  );
  expect(responses.map(r => r.status)).toEqual([200, 200, 200]);
  const row = await db.runbookAgent.findUniqueOrThrow({ where: { id: body.id } });
  expect(row.status).toBe('REVOKED');
  expect(row.enrollmentTokenHash).toBeNull();
  expect(row.enrollmentExpiresAt).toBeNull();
  expect(await db.auditLog.count({ where: { action: 'runbook.agent.revoked' } })).toBe(1);
  // A syntactically valid public key is required before the consumed-token guard.
  const { generateKeyPairSync } = await import('node:crypto');
  const publicKey = generateKeyPairSync('ed25519')
    .publicKey.export({ type: 'spki', format: 'pem' })
    .toString();
  await expect(
    consumeEnrollmentToken({ token: body.token, publicKey, version: '2.0.0', platform: 'linux' })
  ).rejects.toThrow('invalid, expired, or already consumed');
});
it('requires retry keys and rejects unknown input before enrollment', async () => {
  const credential = await createV2Credential(scopes);
  expect(
    (
      await invokeV2(
        enroll,
        credential.token,
        'POST',
        '/runbooks/agent-enrollments',
        {},
        { name: 'No key' }
      )
    ).status
  ).toBe(400);
  expect(
    (
      await invokeV2(
        enroll,
        credential.token,
        'POST',
        '/runbooks/agent-enrollments',
        {},
        { name: 'Unknown input', role: 'ADMIN' },
        { 'Idempotency-Key': 'extra' }
      )
    ).status
  ).toBe(400);
  expect(await db.runbookAgent.count()).toBe(0);
});
it.each(['ADMIN', 'RESPONDER', 'AUDITOR', 'USER'] as const)(
  'broad administrator keys cannot imply fleet scopes (%s)',
  async role => {
    const credential = await createV2Credential(['admin:manage'], role);
    expect((await issue(credential.token)).status).toBe(403);
    expect(
      (await invokeV2(listAgents, credential.token, 'GET', '/runbooks/agents', {})).status
    ).toBe(403);
  }
);
it.each(['RESPONDER', 'AUDITOR', 'USER'] as const)(
  'explicit fleet scopes do not bypass administrator capability (%s)',
  async role => {
    const credential = await createV2Credential(scopes, role);
    expect((await issue(credential.token)).status).toBe(403);
    expect(
      (await invokeV2(listAgents, credential.token, 'GET', '/runbooks/agents', {})).status
    ).toBe(403);
  }
);

it('a claim cannot pass an uncommitted identity revocation and assign after it commits', async () => {
  const credential = await createV2Credential(scopes);
  const body = (await (await issue(credential.token)).json()).data;
  await db.runbookAgent.update({
    where: { id: body.id },
    data: { status: 'ONLINE', capabilities: ['RUNBOOK_BASH'] },
  });
  let ready!: () => void;
  let release!: () => void;
  const locked = new Promise<void>(resolve => {
    ready = resolve;
  });
  const unlock = new Promise<void>(resolve => {
    release = resolve;
  });
  const revocation = db.$transaction(
    async tx => {
      await revokeRunbookAgent(
        body.id,
        { id: credential.user.id, apiKeyId: credential.key.id },
        tx
      );
      ready();
      await unlock;
    },
    { timeout: 10_000 }
  );
  // Propagate an early transaction failure rather than leaving the barrier pending.
  await Promise.race([
    locked,
    revocation.then(() => {
      throw new Error('Revocation ended before the lock barrier');
    }),
  ]);
  let settled = false;
  const claim = claimAgentAttempt(body.id, true).then(
    () => {
      settled = true;
      return 'unexpected assignment eligibility';
    },
    error => {
      settled = true;
      return error;
    }
  );
  try {
    await delay(100);
    expect(settled).toBe(false);
  } finally {
    release();
    await revocation;
  }
  expect(await claim).toMatchObject({ code: 'RUNBOOK_AGENT_NOT_FOUND' });
});

it('reports an expired enrollment without returning or renewing its token', async () => {
  const credential = await createV2Credential(scopes);
  const body = (await (await issue(credential.token)).json()).data;
  await db.runbookAgent.update({
    where: { id: body.id },
    data: { enrollmentExpiresAt: new Date(Date.now() - 60_000) },
  });
  const response = await invokeV2(
    enrollmentStatus,
    credential.token,
    'GET',
    `/runbooks/agent-enrollments/${body.id}`,
    { id: body.id }
  );
  expect(response.status).toBe(200);
  const result = (await response.json()).data;
  expect(result.enrollmentState).toBe('EXPIRED');
  expect(result).not.toHaveProperty('token');
  expect(
    (
      await db.runbookAgent.findUniqueOrThrow({ where: { id: body.id } })
    ).enrollmentExpiresAt!.getTime()
  ).toBeLessThan(Date.now());
});

it('cursor pages tied timestamps without duplicate or missing Agents and rejects tampering', async () => {
  const credential = await createV2Credential(['runbook-agents:read']);
  const at = new Date('2026-10-19T10:00:00Z');
  await db.runbookAgent.createMany({
    data: ['first', 'second', 'third'].map(name => ({ name, createdAt: at })),
  });
  let cursor: string | null = null;
  const ids: string[] = [];
  for (let page = 0; page < 3; page++) {
    const response = await invokeV2(
      listAgents,
      credential.token,
      'GET',
      `/runbooks/agents?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      {}
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toHaveLength(1);
    ids.push(body.data[0].id);
    cursor = body.pagination.nextCursor;
    expect(Boolean(cursor)).toBe(page < 2);
  }
  expect(new Set(ids).size).toBe(3);
  expect(
    (await invokeV2(listAgents, credential.token, 'GET', '/runbooks/agents?cursor=invalid', {}))
      .status
  ).toBe(400);
});
it.each(['runbook-agents:read', 'runbook-agents:enroll', 'runbook-agents:revoke'])(
  'fleet privileges remain separate: %s',
  async scope => {
    const credential = await createV2Credential([scope]);
    const agent = await db.runbookAgent.create({ data: { name: 'Independent privilege fixture' } });
    expect((await issue(credential.token)).status).toBe(
      scope === 'runbook-agents:enroll' ? 201 : 403
    );
    expect(
      (await invokeV2(listAgents, credential.token, 'GET', '/runbooks/agents', {})).status
    ).toBe(scope === 'runbook-agents:read' ? 200 : 403);
    expect(
      (
        await invokeV2(
          revoke,
          credential.token,
          'POST',
          `/runbooks/agents/${agent.id}/revoke`,
          { id: agent.id },
          {},
          { 'Idempotency-Key': 'independent-revocation' }
        )
      ).status
    ).toBe(scope === 'runbook-agents:revoke' ? 200 : 403);
  }
);
it('returns 404 for missing fleet identities without creating retry receipts', async () => {
  const credential = await createV2Credential(scopes);
  const id = 'c' + '0'.repeat(24);
  expect(
    (await invokeV2(getAgent, credential.token, 'GET', `/runbooks/agents/${id}`, { id })).status
  ).toBe(404);
  expect(
    (
      await invokeV2(
        revoke,
        credential.token,
        'POST',
        `/runbooks/agents/${id}/revoke`,
        { id },
        {},
        { 'Idempotency-Key': 'missing' }
      )
    ).status
  ).toBe(404);
  expect(await db.backgroundJob.count()).toBe(0);
});
