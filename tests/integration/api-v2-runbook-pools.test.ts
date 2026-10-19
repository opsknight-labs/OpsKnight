import { beforeEach, expect, it } from 'vitest';
import { POST as create, GET as list } from '@/app/api/v2/runbooks/agent-pools/route';
import { PATCH as patch, DELETE as remove } from '@/app/api/v2/runbooks/agent-pools/[id]/route';
import { PUT as addMember } from '@/app/api/v2/runbooks/agent-pools/[id]/members/[agentId]/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { testPrisma as db, resetDatabase } from '../helpers/test-db';
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
const scopes = ['runbook-agents:read', 'runbook-agent-pools:write'];
it('concurrent creation retries create one pool and one canonical business audit', async () => {
  const credential = await createV2Credential(scopes);
  const send = () =>
    invokeV2(
      create,
      credential.token,
      'POST',
      '/runbooks/agent-pools',
      {},
      { name: 'Shared fixture' },
      { 'Idempotency-Key': 'pool-create' }
    );
  const responses = await Promise.all([send(), send(), send()]);
  expect(responses.map(r => r.status)).toEqual([201, 201, 201]);
  expect(await db.runbookAgentPool.count()).toBe(1);
  expect(await db.auditLog.count({ where: { action: 'runbook.agent_pool.created' } })).toBe(1);
});
it('rejects stale revisions and keeps no-op updates free of audits and revision churn', async () => {
  const credential = await createV2Credential(scopes);
  const first = await invokeV2(
    create,
    credential.token,
    'POST',
    '/runbooks/agent-pools',
    {},
    { name: 'Initial' },
    { 'Idempotency-Key': 'create' }
  );
  const { data } = await first.json();
  const change = (name: string, key: string) =>
    invokeV2(
      patch,
      credential.token,
      'PATCH',
      `/runbooks/agent-pools/${data.id}`,
      { id: data.id },
      { name },
      { 'If-Match': first.headers.get('etag')!, 'Idempotency-Key': key }
    );
  const noop = await change('Initial', 'noop');
  expect(noop.status).toBe(200);
  expect(noop.headers.get('etag')).toBe(first.headers.get('etag'));
  expect(await db.auditLog.count({ where: { action: 'runbook.agent_pool.updated' } })).toBe(0);
  expect((await change('Changed', 'change')).status).toBe(200);
  expect((await change('Lost update', 'stale')).status).toBe(412);
});
it('requires pool write scope and refuses deletion of a secret-granted pool', async () => {
  const credential = await createV2Credential(scopes);
  const first = await invokeV2(
    create,
    credential.token,
    'POST',
    '/runbooks/agent-pools',
    {},
    { name: 'Referenced' },
    { 'Idempotency-Key': 'create' }
  );
  const { data } = await first.json();
  const secret = await db.runbookSecret.create({
    data: {
      name: 'dependency-fixture',
      valueEncrypted: 'fixture-not-used-for-execution',
      createdById: credential.user.id,
    },
  });
  await db.runbookSecretGrant.create({ data: { secretId: secret.id, agentPoolId: data.id } });
  const response = await invokeV2(
    remove,
    credential.token,
    'DELETE',
    `/runbooks/agent-pools/${data.id}`,
    { id: data.id },
    undefined,
    { 'If-Match': first.headers.get('etag')!, 'Idempotency-Key': 'delete' }
  );
  expect(response.status).toBe(409);
  expect(await db.runbookAgentPool.count()).toBe(1);
  const reader = await createV2Credential(['runbook-agents:read']);
  expect((await invokeV2(list, reader.token, 'GET', '/runbooks/agent-pools', {})).status).toBe(200);
  expect(
    (
      await invokeV2(
        create,
        reader.token,
        'POST',
        '/runbooks/agent-pools',
        {},
        { name: 'Denied' },
        { 'Idempotency-Key': 'denied' }
      )
    ).status
  ).toBe(403);
});
it('membership writes use the pool revision and reject revoked targets', async () => {
  const credential = await createV2Credential(scopes);
  const first = await invokeV2(
    create,
    credential.token,
    'POST',
    '/runbooks/agent-pools',
    {},
    { name: 'Membership fixture' },
    { 'Idempotency-Key': 'create' }
  );
  const { data } = await first.json();
  const agent = await db.runbookAgent.create({
    data: { name: 'Revoked fixture', status: 'REVOKED', createdById: credential.user.id },
  });
  const response = await invokeV2(
    addMember,
    credential.token,
    'PUT',
    `/runbooks/agent-pools/${data.id}/members/${agent.id}`,
    { id: data.id, agentId: agent.id },
    {},
    { 'If-Match': first.headers.get('etag')!, 'Idempotency-Key': 'member' }
  );
  expect(response.status).toBe(409);
  expect(await db.runbookAgentPoolMember.count()).toBe(0);
});
