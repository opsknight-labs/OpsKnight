import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashTokenV2 } from '@/lib/api-keys';
import {
  createTestUser,
  createTestIncident,
  createTestService,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';
import { POST as createRunbookRoute } from '@/app/api/v2/runbooks/route';
import { PATCH as editDraft } from '@/app/api/v2/runbooks/[id]/drafts/[versionId]/route';
import { POST as publishDraft } from '@/app/api/v2/runbooks/[id]/drafts/[versionId]/publish/route';
import { POST as cloneDraft } from '@/app/api/v2/runbooks/[id]/drafts/route';
import { POST as validateDraft } from '@/app/api/v2/runbooks/[id]/drafts/[versionId]/validate/route';
import { POST as reopen } from '@/app/api/v2/incidents/[id]/reopen/route';
import { POST as addParticipant } from '@/app/api/v2/schedules/[id]/layers/[layerId]/participants/route';
import { PATCH as moveParticipant } from '@/app/api/v2/schedules/[id]/layers/[layerId]/participants/[userId]/route';
import { createRunbook, updateDraftVersion, publishDraftVersion } from '@/lib/runbooks/versioning';

type Handler = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) => Promise<Response>;
async function credential(
  scopes = ['admin:manage', 'runbooks:write', 'runbooks:publish', 'runbooks:execute']
) {
  const user = await createTestUser({ role: 'ADMIN' });
  const token = `ok_test_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const key = await testPrisma.apiKey.create({
    data: {
      name: 'isolated REST certification',
      prefix: token.slice(0, 12),
      tokenHash: hashTokenV2(token),
      scopes,
      userId: user.id,
    },
  });
  return { user, token, key };
}
function call(
  handler: Handler,
  token: string,
  method: string,
  path: string,
  params: Record<string, string>,
  body: unknown,
  key: string = randomUUID(),
  etag?: string
) {
  return handler(
    new NextRequest(`http://localhost/api/v2${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': key,
        'content-type': 'application/json',
        ...(etag ? { 'if-match': etag } : {}),
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve(params) }
  );
}
const definition = {
  steps: [{ key: 'verify', name: 'Verify recovery', type: 'MANUAL', config: {} }],
};

describe('enterprise REST commands against PostgreSQL', () => {
  beforeEach(async () => {
    const name = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
    if (!name.endsWith('_test'))
      throw new Error(
        'Enterprise REST certification requires a dedicated database whose name ends in _test.'
      );
    await resetDatabase();
  }, 120_000);

  it('creates exactly one runbook and API audit under concurrent identical requests', async () => {
    const { token, key } = await credential();
    const body = { name: 'Verify', slug: 'verify', description: '' };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        call(createRunbookRoute, token, 'POST', '/runbooks', {}, body, 'same-create')
      )
    );
    expect(results.map(response => response.status)).toEqual([201, 201, 201, 201]);
    const documents = await Promise.all(results.map(response => response.json()));
    expect(new Set(documents.map(document => document.data.id)).size).toBe(1);
    expect(await testPrisma.runbook.count()).toBe(1);
    expect(await testPrisma.runbookVersion.count()).toBe(1);
    const audits = await testPrisma.auditLog.findMany({ where: { action: 'runbook.created' } });
    expect(audits).toHaveLength(1);
    expect(audits[0].details).toMatchObject({ source: 'API', metadata: { apiClientId: key.id } });
    expect(JSON.stringify(audits[0])).toContain(key.id);
    expect(JSON.stringify(documents)).not.toContain('"definition"');
  });

  it('runs the REST and UI publication commands with equivalent business invariants', async () => {
    const { token, user } = await credential();
    const uiRunbook = await createRunbook({ name: 'UI', slug: 'ui', description: '' }, user.id);
    const uiDraft = await updateDraftVersion(
      uiRunbook.draftVersion.id,
      { definition, inputs: [], expectedDraftRevision: 0 },
      user.id
    );
    const uiPublished = await publishDraftVersion(uiDraft.id, user.id);

    const created = await call(
      createRunbookRoute,
      token,
      'POST',
      '/runbooks',
      {},
      { name: 'API', slug: 'api', description: '' }
    );
    expect(created.status).toBe(201);
    const api = (await created.json()).data;
    const params = { id: api.id, versionId: api.draftVersionId };
    const path = `/runbooks/${api.id}/drafts/${api.draftVersionId}`;
    const edited = await call(
      editDraft,
      token,
      'PATCH',
      path,
      params,
      { definition },
      'edit-once',
      '"0"'
    );
    expect(edited.status).toBe(200);
    expect(edited.headers.get('etag')).toBe('"1"');
    expect((await call(validateDraft, token, 'POST', `${path}/validate`, params, {})).status).toBe(
      200
    );
    const published = await call(
      publishDraft,
      token,
      'POST',
      `${path}/publish`,
      params,
      {},
      'publish-once',
      '"1"'
    );
    expect(published.status).toBe(200);
    const publishedData = (await published.json()).data;
    expect(publishedData).toMatchObject({
      state: 'PUBLISHED',
      checksum: uiPublished.checksum,
      draftRevision: uiPublished.draftRevision,
    });
    const replay = await call(
      publishDraft,
      token,
      'POST',
      `${path}/publish`,
      params,
      {},
      'publish-once',
      '"1"'
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect(
      await testPrisma.auditLog.count({
        where: { action: 'runbook.version.published', entityId: api.draftVersionId },
      })
    ).toBe(1);

    // A second publication must retire the previous immutable version without violating its DB trigger.
    const cloned = await call(
      cloneDraft,
      token,
      'POST',
      `/runbooks/${api.id}/drafts`,
      { id: api.id },
      { sourceVersionId: api.draftVersionId }
    );
    expect(cloned.status).toBe(201);
    const next = (await cloned.json()).data;
    expect(
      (
        await call(
          publishDraft,
          token,
          'POST',
          `/runbooks/${api.id}/drafts/${next.id}/publish`,
          { id: api.id, versionId: next.id },
          {},
          'publish-next',
          '"0"'
        )
      ).status
    ).toBe(200);
    expect(
      (await testPrisma.runbookVersion.findUniqueOrThrow({ where: { id: api.draftVersionId } }))
        .state
    ).toBe('RETIRED');
  });

  it('allows exactly one of two conflicting draft edits and rejects missing preconditions', async () => {
    const { token, user } = await credential();
    const runbook = await createRunbook({ name: 'Race', slug: 'race', description: '' }, user.id);
    const params = { id: runbook.id, versionId: runbook.draftVersion.id };
    const path = `/runbooks/${params.id}/drafts/${params.versionId}`;
    expect((await call(editDraft, token, 'PATCH', path, params, { definition })).status).toBe(428);
    const responses = await Promise.all(
      ['writer-one', 'writer-two'].map(name =>
        call(
          editDraft,
          token,
          'PATCH',
          path,
          params,
          { definition: { steps: [{ ...definition.steps[0], name }] } },
          name,
          '"0"'
        )
      )
    );
    expect(responses.map(response => response.status).sort()).toEqual([200, 412]);
    expect(
      (await testPrisma.runbookVersion.findUniqueOrThrow({ where: { id: params.versionId } }))
        .draftRevision
    ).toBe(1);
  });

  it('replays reopening without duplicate lifecycle events or outbox effects', async () => {
    const { token } = await credential();
    const service = await createTestService('reopen');
    const incident = await createTestIncident('Resolved', service.id, {
      status: 'RESOLVED',
      resolvedAt: new Date(),
    });
    const path = `/incidents/${incident.id}/reopen`;
    const first = await call(
      reopen,
      token,
      'POST',
      path,
      { id: incident.id },
      { note: 'Recurrence' },
      'reopen-once'
    );
    expect(first.status).toBe(200);
    const eventCount = await testPrisma.incidentEvent.count({ where: { incidentId: incident.id } });
    const jobCount = await testPrisma.backgroundJob.count();
    const replay = await call(
      reopen,
      token,
      'POST',
      path,
      { id: incident.id },
      { note: 'Recurrence' },
      'reopen-once'
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    expect(await testPrisma.incidentEvent.count({ where: { incidentId: incident.id } })).toBe(
      eventCount
    );
    expect(await testPrisma.backgroundJob.count()).toBe(jobCount);
    expect(
      (await testPrisma.incident.findUniqueOrThrow({ where: { id: incident.id } })).status
    ).toBe('OPEN');
  });

  it('preserves participant uniqueness and makes relative moves safe to retry', async () => {
    const { token } = await credential();
    const schedule = await testPrisma.onCallSchedule.create({
      data: { name: 'Rotation', timeZone: 'UTC' },
    });
    const layer = await testPrisma.onCallLayer.create({
      data: { scheduleId: schedule.id, name: 'Primary', start: new Date() },
    });
    const first = await createTestUser({ role: 'RESPONDER' });
    const second = await createTestUser({ role: 'RESPONDER' });
    const path = `/schedules/${schedule.id}/layers/${layer.id}/participants`;
    const params = { id: schedule.id, layerId: layer.id };
    for (const user of [first, second])
      expect(
        (await call(addParticipant, token, 'POST', path, params, { userId: user.id })).status
      ).toBe(201);
    const movedParams = { ...params, userId: second.id };
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(
        (
          await call(
            moveParticipant,
            token,
            'PATCH',
            `${path}/${second.id}`,
            movedParams,
            { direction: 'up' },
            'move-once'
          )
        ).status
      ).toBe(200);
    }
    const order = await testPrisma.onCallLayerUser.findMany({
      where: { layerId: layer.id },
      orderBy: { position: 'asc' },
    });
    expect(order.map(item => item.userId)).toEqual([second.id, first.id]);
    expect(
      (await call(addParticipant, token, 'POST', path, params, { userId: second.id })).status
    ).toBe(409);
  });

  it('denies infrastructure authoring with only admin:manage and leaves no rows behind', async () => {
    const { token } = await credential(['admin:manage']);
    expect(
      (
        await call(
          createRunbookRoute,
          token,
          'POST',
          '/runbooks',
          {},
          { name: 'Denied', slug: 'denied' }
        )
      ).status
    ).toBe(403);
    expect(await testPrisma.runbook.count()).toBe(0);
    expect(await testPrisma.runbookVersion.count()).toBe(0);
    expect(await testPrisma.auditLog.count({ where: { action: 'runbook.created' } })).toBe(0);
  });

  it('rolls back the runbook, draft and replay record when the mandatory audit insert fails', async () => {
    const { token } = await credential();
    await testPrisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION test_rest_reject_runbook_audit() RETURNS trigger AS $$
      BEGIN
        IF NEW.action = 'runbook.created' THEN
          RAISE EXCEPTION 'Injected certification audit failure' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await testPrisma.$executeRawUnsafe(`
      CREATE TRIGGER test_rest_reject_runbook_audit_trigger BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION test_rest_reject_runbook_audit()
    `);
    try {
      const response = await call(
        createRunbookRoute,
        token,
        'POST',
        '/runbooks',
        {},
        { name: 'Rollback', slug: 'rollback' },
        'audit-fails'
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(await testPrisma.runbook.count()).toBe(0);
      expect(await testPrisma.runbookVersion.count()).toBe(0);
      expect(await testPrisma.backgroundJob.count()).toBe(0);
    } finally {
      await testPrisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS test_rest_reject_runbook_audit_trigger ON "AuditLog"'
      );
      await testPrisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS test_rest_reject_runbook_audit()'
      );
    }
    // The failed transaction did not reserve the client's key; the same request can succeed.
    expect(
      (
        await call(
          createRunbookRoute,
          token,
          'POST',
          '/runbooks',
          {},
          { name: 'Rollback', slug: 'rollback' },
          'audit-fails'
        )
      ).status
    ).toBe(201);
  });
});
