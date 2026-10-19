import { beforeEach, expect, it } from 'vitest';
import { POST as createSecret, GET as listSecrets } from '@/app/api/v2/runbooks/secrets/route';
import { POST as rotateSecret } from '@/app/api/v2/runbooks/secrets/[id]/rotate/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { testPrisma as db, resetDatabase } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});
const scopes = ['runbook-secrets:read', 'runbook-secrets:write'];
const value = 'private-material-do-not-persist-in-receipts';
it('encrypts submitted values and excludes them from responses, audit and retry receipts', async () => {
  const credential = await createV2Credential(scopes);
  const send = (submitted = value) =>
    invokeV2(
      createSecret,
      credential.token,
      'POST',
      '/runbooks/secrets',
      {},
      { name: 'rotation-fixture', value: submitted },
      { 'Idempotency-Key': 'secret-once' }
    );
  const first = await send();
  expect(first.status).toBe(201);
  const body = await first.json();
  const row = await db.runbookSecret.findUniqueOrThrow({ where: { id: body.data.id } });
  expect(row.valueEncrypted).not.toContain(value);
  expect(JSON.stringify(body)).not.toContain(value);
  const replay = await send();
  expect(replay.status).toBe(201);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await send('different-private-material')).status).toBe(409);
  expect(await db.runbookSecret.count()).toBe(1);
  expect(JSON.stringify(await db.backgroundJob.findMany())).not.toContain(value);
  expect(JSON.stringify(await db.auditLog.findMany())).not.toContain(value);
  const listing = await invokeV2(listSecrets, credential.token, 'GET', '/runbooks/secrets', {});
  expect(listing.status).toBe(200);
  const text = await listing.text();
  expect(text).not.toContain('valueEncrypted');
  expect(text).not.toContain(row.valueEncrypted);
});
it('enforces rotation revisions and rejects stale writes without changing the value', async () => {
  const credential = await createV2Credential(scopes);
  const created = await invokeV2(
    createSecret,
    credential.token,
    'POST',
    '/runbooks/secrets',
    {},
    { name: 'rotation-fixture', value },
    { 'Idempotency-Key': 'secret-create' }
  );
  expect(created.status).toBe(201);
  const { data } = await created.json();
  const path = `/runbooks/secrets/${data.id}/rotate`;
  const rotate = (key: string, revision?: string) =>
    invokeV2(
      rotateSecret,
      credential.token,
      'POST',
      path,
      { id: data.id },
      { value: 'rotated-private-material' },
      { 'Idempotency-Key': key, ...(revision ? { 'If-Match': revision } : {}) }
    );
  expect((await rotate('missing-revision')).status).toBe(428);
  const updated = await rotate('rotate-once', created.headers.get('etag')!);
  expect(updated.status).toBe(200);
  expect((await updated.json()).data.revision).toBeGreaterThan(data.revision);
  expect((await rotate('rotate-stale', created.headers.get('etag')!)).status).toBe(412);
  expect(JSON.stringify(await db.backgroundJob.findMany())).not.toContain(
    'rotated-private-material'
  );
});
it('does not let broad administration scopes imply secret management', async () => {
  const credential = await createV2Credential(['admin:manage']);
  const response = await invokeV2(
    createSecret,
    credential.token,
    'POST',
    '/runbooks/secrets',
    {},
    { name: 'forbidden', value },
    { 'Idempotency-Key': 'forbidden' }
  );
  expect(response.status).toBe(403);
  expect(await db.runbookSecret.count()).toBe(0);
});
it('serializes grants with revisions and prevents pool membership from bypassing secret-grant scope', async () => {
  const { createRunbookAgentPool, setRunbookPoolMember } =
    await import('@/lib/runbooks/pool-commands');
  const { grantRunbookSecret } = await import('@/lib/runbooks/secrets');
  const credential = await createV2Credential(scopes);
  const actor = { id: credential.user.id, apiKeyId: credential.key.id };
  const created = await invokeV2(
    createSecret,
    credential.token,
    'POST',
    '/runbooks/secrets',
    {},
    { name: 'grant-fixture', value },
    { 'Idempotency-Key': 'grant-create' }
  );
  const { data: secret } = await created.json();
  const pool = await createRunbookAgentPool(
    { name: 'Secret-bearing pool', mode: 'LOCAL_HOSTS' },
    actor
  );
  const agent = await db.runbookAgent.create({
    data: { name: 'Candidate Agent', createdById: credential.user.id },
  });
  await grantRunbookSecret(secret.id, { agentPoolId: pool.id }, actor, {
    expectedRevision: secret.revision,
  });
  const afterGrant = await db.runbookSecret.findUniqueOrThrow({ where: { id: secret.id } });
  expect(afterGrant.revision).toBeGreaterThan(secret.revision);
  expect(afterGrant.lastRotatedAt).toEqual(new Date(secret.lastRotatedAt));
  await expect(
    grantRunbookSecret(secret.id, { agentId: agent.id }, actor, {
      expectedRevision: secret.revision,
    })
  ).rejects.toThrow();
  await expect(
    setRunbookPoolMember(pool.id, agent.id, true, actor, { expectedRevision: pool.revision })
  ).rejects.toThrow('secret-grant scope');
  expect(await db.runbookAgentPoolMember.count()).toBe(0);
  await setRunbookPoolMember(pool.id, agent.id, true, actor, {
    expectedRevision: pool.revision,
    allowSecretScopeExpansion: true,
  });
  const updatedPool = await db.runbookAgentPool.findUniqueOrThrow({ where: { id: pool.id } });
  expect(updatedPool.revision).toBeGreaterThan(pool.revision);
});
it('configuration revisions exclude health churn and include changes from other writers', async () => {
  const credential = await createV2Credential(scopes);
  const agent = await db.runbookAgent.create({
    data: { name: 'Revision fixture', createdById: credential.user.id },
  });
  const heartbeat = await db.runbookAgent.update({
    where: { id: agent.id },
    data: { lastHeartbeatAt: new Date(), status: 'ONLINE' },
  });
  expect(heartbeat.configurationRevision).toBe(agent.configurationRevision);
  const changed = await db.runbookAgent.update({
    where: { id: agent.id },
    data: { labels: { environment: 'production' }, configurationRevision: 999 },
  });
  expect(changed.configurationRevision).toBe(agent.configurationRevision + 1);
});
it('settings creation and mutation require concrete revisions and explicit cleanup confirmation', async () => {
  const { GET, PATCH } = await import('@/app/api/v2/settings/runbooks/route');
  const credential = await createV2Credential(['runbook-settings:read', 'runbook-settings:write']);
  const read = await invokeV2(GET, credential.token, 'GET', '/settings/runbooks', {});
  expect(read.status).toBe(200);
  const etag = read.headers.get('etag')!;
  const send = (body: unknown, key: string) =>
    invokeV2(PATCH, credential.token, 'PATCH', '/settings/runbooks', {}, body, {
      'If-Match': etag,
      'Idempotency-Key': key,
    });
  expect((await send({ runbookArtifactRetentionDays: 30 }, 'no-confirmation')).status).toBe(400);
  const updated = await send(
    { runbookArtifactRetentionDays: 30, confirmArtifactCleanup: true },
    'confirmed'
  );
  expect(updated.status).toBe(200);
  expect(updated.headers.get('etag')).not.toBe(etag);
  expect((await send({ runbookAutoWritesPerIncident: 2 }, 'stale-settings')).status).toBe(412);
});
it('binds grant deletion to its parent secret and does not repeat grant side effects', async () => {
  const { POST } = await import('@/app/api/v2/runbooks/secrets/[id]/grants/route');
  const { DELETE } = await import('@/app/api/v2/runbooks/secrets/[id]/grants/[grantId]/route');
  const credential = await createV2Credential([...scopes, 'runbook-secrets:grant']);
  const create = async (name: string) => {
    const response = await invokeV2(
      createSecret,
      credential.token,
      'POST',
      '/runbooks/secrets',
      {},
      { name, value },
      { 'Idempotency-Key': name }
    );
    expect(response.status).toBe(201);
    return { data: (await response.json()).data, etag: response.headers.get('etag')! };
  };
  const first = await create('first-secret');
  const other = await create('other-secret');
  const agent = await db.runbookAgent.create({
    data: { name: 'Grant target', createdById: credential.user.id },
  });
  const grant = () =>
    invokeV2(
      POST,
      credential.token,
      'POST',
      `/runbooks/secrets/${first.data.id}/grants`,
      { id: first.data.id },
      { agentId: agent.id },
      { 'Idempotency-Key': 'grant-one', 'If-Match': first.etag }
    );
  const accepted = await grant();
  expect(accepted.status).toBe(200);
  const body = (await accepted.json()).data;
  expect((await grant()).headers.get('idempotency-replayed')).toBe('true');
  expect(await db.runbookSecretGrant.count()).toBe(1);
  expect(await db.auditLog.count({ where: { action: 'runbook.secret.granted' } })).toBe(1);
  const wrongParent = await invokeV2(
    DELETE,
    credential.token,
    'DELETE',
    `/runbooks/secrets/${other.data.id}/grants/${body.id}`,
    { id: other.data.id, grantId: body.id },
    undefined,
    { 'Idempotency-Key': 'wrong-parent', 'If-Match': other.etag }
  );
  expect(wrongParent.status).toBe(404);
  expect(await db.runbookSecretGrant.count()).toBe(1);
  const revoked = await invokeV2(
    DELETE,
    credential.token,
    'DELETE',
    `/runbooks/secrets/${first.data.id}/grants/${body.id}`,
    { id: first.data.id, grantId: body.id },
    undefined,
    { 'Idempotency-Key': 'revoke-correct', 'If-Match': accepted.headers.get('etag')! }
  );
  expect(revoked.status).toBe(204);
  expect(await db.runbookSecretGrant.count()).toBe(0);
});
it('reports exact secret references with bounded stable pagination and no submitted input values', async () => {
  const { GET } = await import('@/app/api/v2/runbooks/secrets/[id]/usage/route');
  const { createTestService } = await import('../helpers/test-db');
  const credential = await createV2Credential(scopes);
  const created = await invokeV2(
    createSecret,
    credential.token,
    'POST',
    '/runbooks/secrets',
    {},
    { name: 'usage-secret', value },
    { 'Idempotency-Key': 'usage-create' }
  );
  const secret = (await created.json()).data;
  const runbook = await db.runbook.create({ data: { name: 'Usage', slug: 'usage' } });
  const version = await db.runbookVersion.create({
    data: {
      runbookId: runbook.id,
      version: 1,
      state: 'DRAFT',
      definition: { steps: [] },
      checksum: 'usage-checksum',
      inputs: {
        create: {
          key: 'token',
          label: 'Token',
          type: 'SECRET_REF',
          defaultValue: 'secret://usage-secret',
        },
      },
    },
  });
  const service = await createTestService('Usage service');
  await db.serviceAutomationRule.create({
    data: {
      serviceId: service.id,
      runbookId: runbook.id,
      inputValues: { token: 'secret://usage-secret', opaque: 'private-unrelated-input' },
    },
  });
  await db.runbookExecution.create({
    data: {
      runbookId: runbook.id,
      runbookVersionId: version.id,
      inputValues: { token: 'secret://usage-secret' },
      definitionChecksum: version.checksum,
      deadlineAt: new Date(),
    },
  });
  await db.serviceAutomationRule.create({
    data: {
      serviceId: service.id,
      runbookId: runbook.id,
      inputValues: { token: 'secret://usage-secret-other' },
    },
  });
  const ids: string[] = [];
  const sources: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 4; page++) {
    const response = await invokeV2(
      GET,
      credential.token,
      'GET',
      `/runbooks/secrets/${secret.id}/usage?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      { id: secret.id }
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.length).toBeLessThanOrEqual(1);
    expect(JSON.stringify(body)).not.toContain('private-unrelated-input');
    expect(JSON.stringify(body)).not.toContain(value);
    for (const row of body.data) {
      ids.push(row.id);
      sources.push(row.sourceType);
    }
    cursor = body.pagination.nextCursor;
    if (!cursor) break;
  }
  expect(ids).toHaveLength(3);
  expect(new Set(ids).size).toBe(3);
  expect(sources.sort()).toEqual(['EXECUTION', 'INPUT_DEFAULT', 'SERVICE_RULE']);
  const invalid = await invokeV2(
    GET,
    credential.token,
    'GET',
    `/runbooks/secrets/${secret.id}/usage?cursor=invalid`,
    { id: secret.id }
  );
  expect(invalid.status).toBe(400);
});
