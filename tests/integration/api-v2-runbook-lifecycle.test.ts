import { GET as compare } from '@/app/api/v2/runbooks/[id]/versions/[versionId]/diff/route';
import { getVersionImpact } from '@/lib/runbooks/version-impact';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import addFormats from 'ajv-formats';
import { getOpenApiV2Spec } from '@/lib/api-v2/openapi';
import { hashTokenV2 } from '@/lib/api-keys';
import {
  createRunbook,
  publishDraftVersion,
  cloneVersionToDraft,
  updateDraftVersion,
} from '@/lib/runbooks/versioning';
import { GET as metadata } from '@/app/api/v2/runbooks/[id]/metadata/route';
import { GET as deletionCheck } from '@/app/api/v2/runbooks/[id]/delete-check/route';
import { PATCH as update, DELETE as remove } from '@/app/api/v2/runbooks/[id]/route';
import { POST as archive } from '@/app/api/v2/runbooks/[id]/archive/route';
import { POST as restore } from '@/app/api/v2/runbooks/[id]/restore/route';
import { POST as duplicate } from '@/app/api/v2/runbooks/[id]/duplicate/route';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';
import type { AppRole } from '@/lib/authorization';

type Handler = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) => Promise<Response>;
async function fixture(role: AppRole = 'ADMIN', scopes = ['runbooks:write']) {
  const user = await createTestUser({ role });
  const token = `ok_test_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
  const key = await db.apiKey.create({
    data: {
      name: 'Lifecycle certification',
      prefix: token.slice(0, 12),
      tokenHash: hashTokenV2(token),
      scopes,
      userId: user.id,
    },
  });
  const runbook = await createRunbook(
    {
      name: 'Lifecycle fixture',
      slug: `lifecycle-${randomUUID()}`,
      description: 'Reviewed metadata',
    },
    user.id
  );
  return { user, token, key, runbook };
}
function call(
  handler: Handler,
  token: string,
  id: string,
  method = 'GET',
  suffix = '/metadata',
  body: unknown = {},
  etag?: string,
  key = randomUUID()
) {
  return handler(
    new NextRequest(`http://localhost/api/v2/runbooks/${id}${suffix}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'idempotency-key': key,
        ...(etag ? { 'if-match': etag } : {}),
      },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ id }) }
  );
}
async function read(token: string, id: string) {
  const response = await call(metadata, token, id);
  expect(response.status).toBe(200);
  return { data: (await response.json()).data, etag: response.headers.get('etag')! };
}
function validate(schema: string, data: unknown) {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema({ $id: 'runbook-lifecycle-spec', components: getOpenApiV2Spec().components });
  const check = ajv.getSchema(`runbook-lifecycle-spec#/components/schemas/${schema}`)!;
  expect(check(data), JSON.stringify(check.errors)).toBe(true);
}
beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});

it('reads unpublished metadata without executable configuration and fences edits from every writer', async () => {
  const { token, runbook } = await fixture();
  const before = await read(token, runbook.id);
  validate('RunbookMetadata', before.data);
  expect(before.data).not.toHaveProperty('definition');
  await db.runbook.update({ where: { id: runbook.id }, data: { description: 'UI edit' } });
  expect(
    (await call(update, token, runbook.id, 'PATCH', '', { name: 'Stale' }, before.etag)).status
  ).toBe(412);
  expect(
    (await call(update, token, runbook.id, 'PATCH', '', { name: 'Wildcard' }, '*')).status
  ).toBe(400);
  expect(
    (await call(update, token, runbook.id, 'PATCH', '', { name: 'Missing validator' })).status
  ).toBe(428);
  expect((await read(token, runbook.id)).data.description).toBe('UI edit');
});
it('commits one canonical API-attributed metadata audit and replays without a second edit', async () => {
  const { token, key, runbook } = await fixture();
  const before = await read(token, runbook.id);
  const replayKey = randomUUID();
  const first = await call(
    update,
    token,
    runbook.id,
    'PATCH',
    '',
    { name: 'Updated' },
    before.etag,
    replayKey
  );
  expect(first.status).toBe(200);
  validate('RunbookMetadata', (await first.json()).data);
  const again = await call(
    update,
    token,
    runbook.id,
    'PATCH',
    '',
    { name: 'Updated' },
    before.etag,
    replayKey
  );
  expect(again.status).toBe(200);
  expect(again.headers.get('idempotency-replayed')).toBe('true');
  const events = await db.auditLog.findMany({
    where: { entityId: runbook.id, action: 'runbook.updated' },
  });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({
    details: expect.objectContaining({ source: 'API', metadata: { apiClientId: key.id } }),
  });
});
it('serializes competing metadata edits so one concrete revision wins', async () => {
  const { token, runbook } = await fixture();
  const before = await read(token, runbook.id);
  const results = await Promise.all(
    ['First', 'Second'].map(name =>
      call(update, token, runbook.id, 'PATCH', '', { name }, before.etag)
    )
  );
  expect(results.map(result => result.status).sort()).toEqual([200, 412]);
  expect(
    await db.auditLog.count({ where: { entityId: runbook.id, action: 'runbook.updated' } })
  ).toBe(1);
});
it('makes archive and restore natural repeats without repeated canonical audits', async () => {
  const { token, runbook } = await fixture();
  const before = await read(token, runbook.id);
  const archived = await call(archive, token, runbook.id, 'POST', '/archive', {}, before.etag);
  expect(archived.status).toBe(200);
  const archivedData = (await archived.json()).data;
  validate('RunbookMetadata', archivedData);
  const repeated = await call(
    archive,
    token,
    runbook.id,
    'POST',
    '/archive',
    {},
    archived.headers.get('etag')!
  );
  expect(repeated.status).toBe(200);
  expect((await repeated.json()).data.archivedAt).toBe(archivedData.archivedAt);
  expect(
    await db.auditLog.count({ where: { entityId: runbook.id, action: 'runbook.archived' } })
  ).toBe(1);
  const restored = await call(
    restore,
    token,
    runbook.id,
    'POST',
    '/restore',
    {},
    archived.headers.get('etag')!
  );
  expect(restored.status).toBe(200);
  const again = await call(
    restore,
    token,
    runbook.id,
    'POST',
    '/restore',
    {},
    restored.headers.get('etag')!
  );
  expect(again.status).toBe(200);
  expect(
    await db.auditLog.count({ where: { entityId: runbook.id, action: 'runbook.restored' } })
  ).toBe(1);
});
it('duplicates to an independent draft with source revision protection and safe replay', async () => {
  const { token, runbook } = await fixture();
  const before = await read(token, runbook.id);
  const replayKey = randomUUID();
  const response = await call(
    duplicate,
    token,
    runbook.id,
    'POST',
    '/duplicate',
    {},
    before.etag,
    replayKey
  );
  expect(response.status).toBe(201);
  const copy = (await response.json()).data;
  validate('RunbookMetadata', copy);
  expect(copy.id).not.toBe(runbook.id);
  expect(copy.publishedVersionId).toBeNull();
  expect(copy.draftVersionId).not.toBe(runbook.draftVersionId);
  expect(copy).not.toHaveProperty('draftVersion');
  expect(response.headers.get('etag')).toBe((await read(token, copy.id)).etag);
  const replay = await call(
    duplicate,
    token,
    runbook.id,
    'POST',
    '/duplicate',
    {},
    before.etag,
    replayKey
  );
  expect(replay.status).toBe(201);
  expect((await replay.json()).data.id).toBe(copy.id);
  expect(await db.runbook.count()).toBe(2);
});
it('treats delete-check as advisory and refuses deletion after publication', async () => {
  const { token, user, runbook } = await fixture();
  const check = await call(deletionCheck, token, runbook.id, 'GET', '/delete-check');
  expect(check.status).toBe(200);
  const data = (await check.json()).data;
  validate('RunbookDeleteEligibility', data);
  expect(data.canDelete).toBe(true);
  await publishDraftVersion(runbook.draftVersionId!, user.id);
  const before = await read(token, runbook.id);
  const response = await call(
    remove,
    token,
    runbook.id,
    'DELETE',
    '',
    { confirmationText: runbook.name },
    before.etag
  );
  expect(response.status).toBe(409);
  expect(await db.runbook.count({ where: { id: runbook.id } })).toBe(1);
  expect(
    (await (await call(deletionCheck, token, runbook.id, 'GET', '/delete-check')).json()).data
      .canDelete
  ).toBe(false);
});
it('requires typed confirmation and safely replays a successful permanent deletion', async () => {
  const { token, runbook } = await fixture();
  const before = await read(token, runbook.id);
  expect(
    (
      await call(
        remove,
        token,
        runbook.id,
        'DELETE',
        '',
        { confirmationText: 'wrong' },
        before.etag
      )
    ).status
  ).toBe(409);
  const replayKey = randomUUID();
  const body = { confirmationText: runbook.name };
  expect(
    (await call(remove, token, runbook.id, 'DELETE', '', body, before.etag, replayKey)).status
  ).toBe(204);
  const replay = await call(remove, token, runbook.id, 'DELETE', '', body, before.etag, replayKey);
  expect(replay.status).toBe(204);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect(await db.runbook.count()).toBe(0);
  expect(
    await db.auditLog.count({ where: { entityId: runbook.id, action: 'runbook.deleted' } })
  ).toBe(1);
});
it.each([
  ['RESPONDER', ['runbooks:write']],
  ['ADMIN', ['runbooks:read']],
] as const)(
  'denies lifecycle administration for %s with insufficient role or scope',
  async (role, scopes) => {
    const { token, runbook } = await fixture(role, [...scopes]);
    for (const [handler, method, suffix] of [
      [metadata, 'GET', '/metadata'],
      [deletionCheck, 'GET', '/delete-check'],
      [archive, 'POST', '/archive'],
      [restore, 'POST', '/restore'],
      [duplicate, 'POST', '/duplicate'],
      [update, 'PATCH', ''],
      [remove, 'DELETE', ''],
    ] as const) {
      expect((await call(handler, token, runbook.id, method, suffix, {}, '"1"')).status).toBe(403);
    }
  }
);
it('rejects revoked credentials and demoted actors before returning a cached lifecycle result', async () => {
  const { token, user, key, runbook } = await fixture();
  const before = await read(token, runbook.id);
  const replayKey = randomUUID();
  const body = { name: 'Privileged edit' };
  expect(
    (await call(update, token, runbook.id, 'PATCH', '', body, before.etag, replayKey)).status
  ).toBe(200);
  await db.user.update({ where: { id: user.id }, data: { role: 'RESPONDER' } });
  expect(
    (await call(update, token, runbook.id, 'PATCH', '', body, before.etag, replayKey)).status
  ).toBe(403);
  await db.apiKey.update({ where: { id: key.id }, data: { revokedAt: new Date() } });
  expect(
    (await call(update, token, runbook.id, 'PATCH', '', body, before.etag, replayKey)).status
  ).toBe(401);
});
it('rejects unknown metadata fields and empty edits without side effects', async () => {
  const { token, runbook } = await fixture();
  const before = await read(token, runbook.id);
  for (const body of [{}, { publishedVersionId: runbook.draftVersionId }, { revision: 9000 }])
    expect((await call(update, token, runbook.id, 'PATCH', '', body, before.etag)).status).toBe(
      400
    );
  expect((await read(token, runbook.id)).etag).toBe(before.etag);
});
it('rolls back metadata, audit and replay when mandatory audit insertion fails', async () => {
  const { token, runbook } = await fixture();
  const before = await read(token, runbook.id);
  const replayKey = randomUUID();
  await db.$executeRawUnsafe(
    `CREATE FUNCTION test_lifecycle_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='runbook.updated' THEN RAISE EXCEPTION 'Lifecycle audit fixture failure' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$`
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER test_lifecycle_audit_fail_trigger BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_lifecycle_audit_fail()`
  );
  try {
    expect(
      (
        await call(
          update,
          token,
          runbook.id,
          'PATCH',
          '',
          { name: 'Rollback' },
          before.etag,
          replayKey
        )
      ).status
    ).toBe(500);
    expect((await read(token, runbook.id)).etag).toBe(before.etag);
    expect(await db.backgroundJob.count()).toBe(0);
  } finally {
    await db.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS test_lifecycle_audit_fail_trigger ON "AuditLog"'
    );
    await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_lifecycle_audit_fail()');
  }
  expect(
    (
      await call(
        update,
        token,
        runbook.id,
        'PATCH',
        '',
        { name: 'Rollback' },
        before.etag,
        replayKey
      )
    ).status
  ).toBe(200);
});

it('compares versions through the shared UI engine without disclosing executable fields or input defaults', async () => {
  const { token, user, runbook } = await fixture();
  const marker = 'fixture-only-hidden-command-and-reference';
  await updateDraftVersion(
    runbook.draftVersionId!,
    {
      definition: {
        steps: [{ key: 'check', name: 'Check', type: 'MANUAL', config: { instructions: marker } }],
      },
      inputs: [
        {
          key: 'environment',
          label: 'Environment',
          type: 'STRING',
          defaultValue: marker,
          description: '',
          required: false,
          sequence: 0,
        },
      ],
      expectedDraftRevision: runbook.draftVersion.draftRevision,
    },
    user.id
  );
  await publishDraftVersion(runbook.draftVersionId!, user.id);
  const next = await cloneVersionToDraft(runbook.draftVersionId!, user.id);
  await updateDraftVersion(
    next.id,
    {
      definition: {
        steps: [
          {
            key: 'check',
            name: 'Check',
            type: 'MANUAL',
            config: { instructions: marker + '-changed' },
          },
        ],
      },
      expectedDraftRevision: next.draftRevision,
    },
    user.id
  );
  const response = await compare(
    new NextRequest(
      `http://localhost/api/v2/runbooks/${runbook.id}/versions/${next.id}/diff?baseVersionId=${runbook.draftVersionId}`,
      { headers: { authorization: `Bearer ${token}` } }
    ),
    { params: Promise.resolve({ id: runbook.id, versionId: next.id }) }
  );
  expect(response.status).toBe(200);
  const data = (await response.json()).data;
  validate('RunbookVersionDiff', data);
  const ui = await getVersionImpact(runbook.id, runbook.draftVersionId!, next.id);
  expect(data.steps.map((step: { change: string }) => step.change)).toEqual(
    ui.steps.map(step => step.change)
  );
  expect(data.steps[0].change).toBe('CHANGED');
  expect(JSON.stringify(data)).not.toContain(marker);
  expect(JSON.stringify(data)).not.toContain('instructions');
  expect(data.steps[0].before).not.toHaveProperty('config');
  const foreign = await createRunbook(
    { name: 'Other parent', slug: 'other-parent', description: '' },
    user.id
  );
  const bad = await compare(
    new NextRequest(
      `http://localhost/api/v2/runbooks/${runbook.id}/versions/${foreign.draftVersionId}/diff?baseVersionId=${runbook.draftVersionId}`,
      { headers: { authorization: `Bearer ${token}` } }
    ),
    { params: Promise.resolve({ id: runbook.id, versionId: foreign.draftVersionId! }) }
  );
  expect(bad.status).toBe(404);
});
