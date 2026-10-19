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

it('allows subtractive selectors but requires explicit authority to expand secret access for UI and REST actors', async () => {
  const { createRunbookAgentPool, updateRunbookAgentPool } =
    await import('@/lib/runbooks/pool-commands');
  const credential = await createV2Credential(scopes);
  const agents = await Promise.all(
    ['east', 'west'].map(zone =>
      db.runbookAgent.create({
        data: { name: zone, labels: { env: 'production', zone }, createdById: credential.user.id },
      })
    )
  );
  const pool = await createRunbookAgentPool(
    { name: 'Dynamic scope', matchLabels: { env: 'production' } },
    credential.user.id
  );
  const secret = await db.runbookSecret.create({
    data: { name: 'selector-secret', valueEncrypted: 'fixture', createdById: credential.user.id },
  });
  await db.runbookSecretGrant.create({ data: { secretId: secret.id, agentPoolId: pool.id } });
  await updateRunbookAgentPool(
    pool.id,
    { matchLabels: { env: 'production', zone: 'east' } },
    credential.user.id
  );
  expect(
    await db.runbookAgentPoolMember.findMany({
      where: { poolId: pool.id },
      select: { agentId: true },
    })
  ).toEqual([{ agentId: agents[0].id }]);
  for (const actor of [
    credential.user.id,
    { id: credential.user.id, apiKeyId: credential.key.id },
  ]) {
    await expect(
      updateRunbookAgentPool(pool.id, { matchLabels: { env: 'production' } }, actor)
    ).rejects.toThrow('secret-grant scope');
  }
  await updateRunbookAgentPool(
    pool.id,
    { matchLabels: { env: 'production' } },
    credential.user.id,
    { allowSecretScopeExpansion: true }
  );
  expect(await db.runbookAgentPoolMember.count({ where: { poolId: pool.id } })).toBe(2);
});
it('single-Agent reconciliation preserves unrelated identities and avoids revision churn for unchanged memberships', async () => {
  const { createRunbookAgentPool, updateRunbookAgentMetadata } =
    await import('@/lib/runbooks/pool-commands');
  const { synchronizeAgentLabelMemberships } = await import('@/lib/runbooks/pool-labels');
  const credential = await createV2Credential(scopes);
  const first = await db.runbookAgent.create({
    data: { name: 'First', labels: { env: 'production' } },
  });
  const other = await db.runbookAgent.create({
    data: { name: 'Other', labels: { env: 'production' } },
  });
  const pool = await createRunbookAgentPool(
    { name: 'Targeted', matchLabels: { env: 'production' } },
    credential.user.id
  );
  const otherMembership = await db.runbookAgentPoolMember.findUniqueOrThrow({
    where: { poolId_agentId: { poolId: pool.id, agentId: other.id } },
  });
  await db.$transaction(tx => synchronizeAgentLabelMemberships(tx, first.id));
  expect((await db.runbookAgentPool.findUniqueOrThrow({ where: { id: pool.id } })).revision).toBe(
    pool.revision
  );
  await updateRunbookAgentMetadata(first.id, { labels: { env: 'staging' } }, credential.user.id);
  expect(await db.runbookAgentPoolMember.findUnique({ where: { id: otherMembership.id } })).toEqual(
    otherMembership
  );
  expect(
    await db.runbookAgentPoolMember.count({ where: { poolId: pool.id, agentId: first.id } })
  ).toBe(0);
});
it('retires a referenced pool without deleting history and rejects new assignments from direct database writers', async () => {
  const { POST } = await import('@/app/api/v2/runbooks/agent-pools/[id]/retire/route');
  const { createTestService } = await import('../helpers/test-db');
  const credential = await createV2Credential(scopes);
  const response = await invokeV2(
    create,
    credential.token,
    'POST',
    '/runbooks/agent-pools',
    {},
    { name: 'Retirement fixture' },
    { 'Idempotency-Key': 'create' }
  );
  const { data: pool } = await response.json();
  const runbook = await db.runbook.create({ data: { name: 'Retirement', slug: 'retirement' } });
  const version = await db.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'DRAFT',
      definition: { steps: [] },
      checksum: 'fixture-checksum',
    },
  });
  const history = await db.runbookExecution.create({
    data: {
      runbookId: runbook.id,
      runbookVersionId: version.id,
      resolvedTargetAgentPoolId: pool.id,
      deadlineAt: new Date(),
      definitionChecksum: version.checksum,
      status: 'SUCCEEDED',
    },
  });
  const service = await createTestService('Retirement service');
  const rule = await db.serviceAutomationRule.create({
    data: {
      runbookId: runbook.id,
      serviceId: service.id,
      defaultAgentPoolId: pool.id,
      enabled: true,
    },
  });
  const retire = () =>
    invokeV2(
      POST,
      credential.token,
      'POST',
      `/runbooks/agent-pools/${pool.id}/retire`,
      { id: pool.id },
      {},
      { 'If-Match': response.headers.get('etag')!, 'Idempotency-Key': 'retire-once' }
    );
  const retired = await retire();
  expect(retired.status).toBe(200);
  expect((await retired.json()).data).toMatchObject({
    lifecycle: 'RETIRED',
    retiredAt: expect.any(String),
  });
  expect((await retire()).headers.get('idempotency-replayed')).toBe('true');
  expect(await db.runbookExecution.findUnique({ where: { id: history.id } })).not.toBeNull();
  expect(
    (await db.serviceAutomationRule.findUniqueOrThrow({ where: { id: rule.id } })).enabled
  ).toBe(false);
  const agent = await db.runbookAgent.create({ data: { name: 'Late assignment' } });
  await expect(
    db.runbookAgentPoolMember.create({ data: { poolId: pool.id, agentId: agent.id } })
  ).rejects.toThrow('Retired Agent pools');
  await expect(
    db.runbookAgentPool.update({
      where: { id: pool.id },
      data: { lifecycle: 'ACTIVE', retiredAt: null },
    })
  ).rejects.toThrow('cannot be reactivated');
  expect(await db.auditLog.count({ where: { action: 'runbook.agent_pool.retired' } })).toBe(1);
});
it('serializes a new secret grant against an Agent label change that would gain pool access', async () => {
  const { createRunbookAgentPool, updateRunbookAgentMetadata } =
    await import('@/lib/runbooks/pool-commands');
  const { grantRunbookSecret } = await import('@/lib/runbooks/secrets');
  const credential = await createV2Credential(scopes);
  const actor = { id: credential.user.id, apiKeyId: credential.key.id };
  const agent = await db.runbookAgent.create({
    data: { name: 'Racing Agent', labels: { env: 'staging' } },
  });
  const pool = await createRunbookAgentPool(
    { name: 'Racing pool', matchLabels: { env: 'production' } },
    actor
  );
  const secret = await db.runbookSecret.create({
    data: { name: 'racing-secret', valueEncrypted: 'fixture' },
  });
  let ready!: () => void;
  let release!: () => void;
  const locked = new Promise<void>(resolve => {
    ready = resolve;
  });
  const unlock = new Promise<void>(resolve => {
    release = resolve;
  });
  const grant = db.$transaction(
    async tx => {
      await grantRunbookSecret(secret.id, { agentPoolId: pool.id }, actor, { client: tx });
      ready();
      await unlock;
    },
    { timeout: 10000 }
  );
  await Promise.race([
    locked,
    grant.then(() => {
      throw new Error('Grant ended before barrier');
    }),
  ]);
  const update = updateRunbookAgentMetadata(
    agent.id,
    { labels: { env: 'production' } },
    actor
  ).then(
    value => ({ value }),
    error => ({ error })
  );
  try {
    let blocked = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      const rows = await db.$queryRaw<
        Array<{ waiting: boolean }>
      >`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event = 'advisory' AND query LIKE '%runbook-label-memberships%') AS waiting`;
      if (rows[0]?.waiting) {
        blocked = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(blocked).toBe(true);
  } finally {
    release();
    await grant;
  }
  const result = await update;
  expect(result).toMatchObject({ error: { code: 'AUTHORIZATION_DENIED' } });
  expect(
    await db.runbookAgentPoolMember.count({ where: { poolId: pool.id, agentId: agent.id } })
  ).toBe(0);
  expect((await db.runbookAgent.findUniqueOrThrow({ where: { id: agent.id } })).labels).toEqual({
    env: 'staging',
  });
});

it('does not report successful removal when the selector would immediately restore Agent access', async () => {
  const { createRunbookAgentPool, setRunbookPoolMember } =
    await import('@/lib/runbooks/pool-commands');
  const credential = await createV2Credential(scopes);
  const agent = await db.runbookAgent.create({
    data: { name: 'Overlapping membership', labels: { env: 'production' } },
  });
  const pool = await createRunbookAgentPool(
    { name: 'Overlapping selector', matchLabels: { env: 'production' } },
    credential.user.id
  );
  await setRunbookPoolMember(pool.id, agent.id, true, credential.user.id);
  await expect(setRunbookPoolMember(pool.id, agent.id, false, credential.user.id)).rejects.toThrow(
    'still matches the pool selector'
  );
  expect(
    await db.runbookAgentPoolMember.findUnique({
      where: { poolId_agentId: { poolId: pool.id, agentId: agent.id } },
    })
  ).toMatchObject({ source: 'EXPLICIT' });
  expect(await db.auditLog.count({ where: { action: 'runbook.agent_pool.member_removed' } })).toBe(
    0
  );
});
