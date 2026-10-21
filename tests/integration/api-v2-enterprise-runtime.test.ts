import { POST as publishAutomationVersion } from '@/app/api/v2/services/[id]/automation/publish/route';
import {
  GET as getAutomationDraft,
  PUT as saveAutomationDraft,
} from '@/app/api/v2/services/[id]/automation/draft/route';
import {
  GET as readAutomationSettings,
  PATCH as writeAutomationSettings,
} from '@/app/api/v2/settings/automation/route';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { hashTokenV2 } from '@/lib/api-keys';
import {
  createTestUser,
  createTestIncident,
  createTestService,
  createTestTeam,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';
import { POST as createRunbookRoute } from '@/app/api/v2/runbooks/route';
import {
  GET as readDraft,
  PATCH as editDraft,
} from '@/app/api/v2/runbooks/[id]/drafts/[versionId]/route';
import { POST as publishDraft } from '@/app/api/v2/runbooks/[id]/drafts/[versionId]/publish/route';
import { POST as cloneDraft } from '@/app/api/v2/runbooks/[id]/drafts/route';
import { POST as validateDraft } from '@/app/api/v2/runbooks/[id]/drafts/[versionId]/validate/route';
import { POST as reopen } from '@/app/api/v2/incidents/[id]/reopen/route';
import { POST as addParticipant } from '@/app/api/v2/schedules/[id]/layers/[layerId]/participants/route';
import { PATCH as moveParticipant } from '@/app/api/v2/schedules/[id]/layers/[layerId]/participants/[userId]/route';
import { POST as executeRoute } from '@/app/api/v2/runbooks/[id]/execute/route';
import { cancelExecution } from '@/lib/runbooks/orchestrator';
import { POST as previewRoute } from '@/app/api/v2/runbooks/[id]/executions/preview/route';
import { POST as cancelRoute } from '@/app/api/v2/runbooks/executions/[id]/cancel/route';
import { POST as addWatcher } from '@/app/api/v2/incidents/[id]/watchers/route';
import type { AppRole } from '@/lib/authorization';
import { createRunbook, updateDraftVersion, publishDraftVersion } from '@/lib/runbooks/versioning';

type Handler = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string>> }
) => Promise<Response>;
async function credential(
  scopes = ['admin:manage', 'runbooks:write', 'runbooks:publish', 'runbooks:execute'],
  role: AppRole = 'ADMIN'
) {
  const user = await createTestUser({ role });
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
      ...(method === 'GET' ? {} : { body: JSON.stringify(body) }),
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

  it('records one credential-attributed start and naturally deduplicates cancellation across keys', async () => {
    const { token, user, key } = await credential();
    const runbook = await createRunbook(
      { name: 'Canonical audit', slug: 'canonical', description: '' },
      user.id
    );
    await publishDraftVersion(runbook.draftVersion.id, user.id);
    const started = await call(
      executeRoute,
      token,
      'POST',
      `/runbooks/${runbook.id}/execute`,
      { id: runbook.id },
      {},
      'start-one'
    );
    expect(started.status).toBe(202);
    const executionId = (await started.json()).data.executionId;
    const starts = await testPrisma.auditLog.findMany({ where: { entityId: executionId } });
    expect(starts).toHaveLength(1);
    expect(starts[0]).toMatchObject({
      action: 'runbook.execution.started',
      entityType: 'RUNBOOK_EXECUTION',
      actorId: user.id,
      details: { source: 'API', metadata: { apiClientId: key.id } },
    });
    expect(
      await testPrisma.auditLog.count({ where: { action: 'runbook.execution_started' } })
    ).toBe(0);
    const path = `/runbooks/executions/${executionId}/cancel`;
    const params = { id: executionId };
    expect(
      (
        await call(
          cancelRoute,
          token,
          'POST',
          path,
          params,
          { reason: 'Original stop' },
          'cancel-first'
        )
      ).status
    ).toBe(202);
    const original = await testPrisma.runbookExecution.findUniqueOrThrow({
      where: { id: executionId },
    });
    const jobs = await testPrisma.backgroundJob.count({ where: { type: 'RUNBOOK' } });
    const responses = await Promise.all(
      ['cancel-second', 'cancel-third', 'cancel-fourth'].map(id =>
        call(cancelRoute, token, 'POST', path, params, { reason: 'Repeated stop' }, id)
      )
    );
    expect(responses.map(response => response.status)).toEqual([202, 202, 202]);
    await cancelExecution(executionId, user.id, 'UI repeat');
    const current = await testPrisma.runbookExecution.findUniqueOrThrow({
      where: { id: executionId },
    });
    expect(current.cancelRequestedAt).toEqual(original.cancelRequestedAt);
    expect(current.failureMessage).toBe('Original stop');
    expect(await testPrisma.backgroundJob.count({ where: { type: 'RUNBOOK' } })).toBe(jobs);
    const audits = await testPrisma.auditLog.findMany({
      where: { entityId: executionId, action: { contains: 'cancel' } },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: 'runbook.execution.cancel.requested',
      entityType: 'RUNBOOK_EXECUTION',
      details: { source: 'API', metadata: { apiClientId: key.id } },
    });
  });

  it('commits one cancellation transition when distinct keys race on an active execution', async () => {
    const { token, user } = await credential();
    const runbook = await createRunbook(
      { name: 'Cancel race', slug: 'cancel-race', description: '' },
      user.id
    );
    const version = await publishDraftVersion(runbook.draftVersion.id, user.id);
    const execution = await testPrisma.runbookExecution.create({
      data: {
        runbookId: runbook.id,
        runbookVersionId: version.id,
        triggeredByUserId: user.id,
        definitionChecksum: version.checksum,
        deadlineAt: new Date(Date.now() + 60_000),
      },
    });
    const responses = await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        call(
          cancelRoute,
          token,
          'POST',
          `/runbooks/executions/${execution.id}/cancel`,
          { id: execution.id },
          { reason: `Stop ${index}` },
          `parallel-${index}`
        )
      )
    );
    expect(responses.map(response => response.status)).toEqual([202, 202, 202, 202]);
    expect(
      await testPrisma.auditLog.count({
        where: { entityId: execution.id, action: 'runbook.execution.cancel.requested' },
      })
    ).toBe(1);
    expect(
      await testPrisma.backgroundJob.count({
        where: { type: 'RUNBOOK', payload: { path: ['executionId'], equals: execution.id } },
      })
    ).toBe(1);
  });

  it('allows responder starts across service teams while rejecting lower roles and missing execution scopes', async () => {
    const admin = await credential();
    const team = await createTestTeam('Other service team');
    const service = await createTestService('Global execution policy', team.id);
    const runbook = await createRunbook(
      { name: 'Execution policy', slug: 'execution-policy', description: '' },
      admin.user.id
    );
    await publishDraftVersion(runbook.draftVersion.id, admin.user.id);
    for (const [role, scopes, expected] of [
      ['RESPONDER', ['runbooks:execute'], 202],
      ['RESPONDER', ['runbooks:read'], 403],
      ['ADMIN', ['admin:manage'], 403],
      ['USER', ['runbooks:execute'], 403],
      ['AUDITOR', ['runbooks:execute'], 403],
    ] as const) {
      const caller = await credential([...scopes], role);
      const before = await testPrisma.runbookExecution.count();
      const response = await call(
        executeRoute,
        caller.token,
        'POST',
        `/runbooks/${runbook.id}/execute`,
        { id: runbook.id },
        { serviceId: service.id }
      );
      expect(response.status).toBe(expected);
      expect(await testPrisma.runbookExecution.count()).toBe(before + (expected === 202 ? 1 : 0));
    }
  });

  it('enforces cancellation ownership and service-team boundaries without side effects on denial', async () => {
    const owner = await credential(['runbooks:execute'], 'RESPONDER');
    const outsider = await credential(['runbooks:execute', 'incidents:read'], 'RESPONDER');
    const teammate = await credential(['runbooks:execute'], 'RESPONDER');
    const administrator = await credential(['runbooks:execute']);
    const team = await createTestTeam('Execution owners');
    const otherTeam = await createTestTeam('Unrelated team');
    await testPrisma.teamMember.createMany({
      data: [
        { teamId: team.id, userId: teammate.user.id, role: 'MEMBER' },
        { teamId: otherTeam.id, userId: outsider.user.id, role: 'MEMBER' },
      ],
    });
    const service = await createTestService('Owned execution service', team.id);
    const unrelated = await createTestService('Other execution service', otherTeam.id);
    const runbook = await createRunbook(
      { name: 'Cancellation', slug: 'cancel', description: '' },
      owner.user.id
    );
    const version = await publishDraftVersion(runbook.draftVersion.id, owner.user.id);
    const makeExecution = (serviceId: string | null, triggeredByUserId: string | null) =>
      testPrisma.runbookExecution.create({
        data: {
          runbookId: runbook.id,
          runbookVersionId: version.id,
          serviceId,
          triggeredByUserId,
          definitionChecksum: version.checksum,
          deadlineAt: new Date(Date.now() + 60_000),
        },
      });
    for (const [token, serviceId, triggeringUser, expected] of [
      [outsider.token, null, owner.user.id, 404],
      [outsider.token, service.id, owner.user.id, 404],
      [teammate.token, unrelated.id, owner.user.id, 404],
      [owner.token, null, owner.user.id, 202],
      [teammate.token, service.id, null, 202],
      [administrator.token, null, null, 202],
    ] as const) {
      const execution = await makeExecution(serviceId, triggeringUser);
      const auditBefore = await testPrisma.auditLog.count();
      const jobsBefore = await testPrisma.backgroundJob.count();
      const response = await call(
        cancelRoute,
        token,
        'POST',
        `/runbooks/executions/${execution.id}/cancel`,
        { id: execution.id },
        { reason: 'Operator requested stop' }
      );
      expect(response.status).toBe(expected);
      const stored = await testPrisma.runbookExecution.findUniqueOrThrow({
        where: { id: execution.id },
      });
      expect(stored.status).toBe(expected === 202 ? 'CANCEL_REQUESTED' : 'QUEUED');
      if (expected === 404) {
        expect(await testPrisma.auditLog.count()).toBe(auditBefore);
        expect(await testPrisma.backgroundJob.count()).toBe(jobsBefore);
      }
    }
    const incident = await createTestIncident('Visible incident, unrelated operator', service.id);
    const attached = await makeExecution(service.id, owner.user.id);
    await testPrisma.runbookExecution.update({
      where: { id: attached.id },
      data: { incidentId: incident.id },
    });
    expect(
      (
        await call(
          cancelRoute,
          outsider.token,
          'POST',
          `/runbooks/executions/${attached.id}/cancel`,
          { id: attached.id },
          { reason: 'Unauthorized stop' }
        )
      ).status
    ).toBe(404);
    expect(
      (await testPrisma.runbookExecution.findUniqueOrThrow({ where: { id: attached.id } })).status
    ).toBe('QUEUED');
  });

  it('rejects wildcard draft edit and publish with no version or audit changes', async () => {
    const { token, user } = await credential();
    const runbook = await createRunbook(
      { name: 'Exact revision', slug: 'exact', description: '' },
      user.id
    );
    const params = { id: runbook.id, versionId: runbook.draftVersion.id };
    const audits = await testPrisma.auditLog.count();
    for (const [handler, method, suffix, body] of [
      [editDraft, 'PATCH', '', { definition }],
      [publishDraft, 'POST', '/publish', {}],
    ] as const) {
      expect(
        (
          await call(
            handler,
            token,
            method,
            `/runbooks/${params.id}/drafts/${params.versionId}${suffix}`,
            params,
            body,
            randomUUID(),
            '*'
          )
        ).status
      ).toBe(400);
    }
    const stored = await testPrisma.runbookVersion.findUniqueOrThrow({
      where: { id: params.versionId },
    });
    expect(stored.state).toBe('DRAFT');
    expect(stored.draftRevision).toBe(0);
    expect(await testPrisma.auditLog.count()).toBe(audits);
  });

  it('round trips a privileged editing view without disclosing or erasing configuration and defaults', async () => {
    const { token, user } = await credential();
    const runbook = await createRunbook(
      { name: 'Editable', slug: 'editable', description: '' },
      user.id
    );
    const saved = await updateDraftVersion(
      runbook.draftVersion.id,
      {
        definition: {
          steps: [
            {
              key: 'one',
              name: 'One',
              type: 'BASH',
              riskClass: 'NON_IDEMPOTENT',
              config: { command: 'echo PRIVATE_COMMAND' },
            },
            {
              key: 'two',
              name: 'Two',
              type: 'MANUAL',
              config: { instructions: 'PRIVATE_INSTRUCTIONS' },
            },
          ],
        },
        inputs: [
          {
            key: 'count',
            label: 'Count',
            type: 'NUMBER',
            required: false,
            defaultValue: '42',
            description: '',
            sequence: 0,
          },
        ],
        expectedDraftRevision: 0,
      },
      user.id
    );
    const params = { id: runbook.id, versionId: saved.id };
    const path = `/runbooks/${params.id}/drafts/${params.versionId}`;
    const response = await call(readDraft, token, 'GET', path, params, undefined);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const document = await response.json();
    expect(JSON.stringify(document)).not.toContain('PRIVATE_');
    expect(document.data.editable.inputs[0]).not.toHaveProperty('defaultValue');
    const editable = document.data.editable;
    editable.definition.steps.reverse();
    editable.definition.steps[1].name = 'Renamed one';
    const updated = await call(
      editDraft,
      token,
      'PATCH',
      path,
      params,
      editable,
      randomUUID(),
      response.headers.get('etag')!
    );
    expect(updated.status).toBe(200);
    const stored = await testPrisma.runbookVersion.findUniqueOrThrow({
      where: { id: saved.id },
      include: { inputs: true },
    });
    expect(stored.definition).toMatchObject({
      steps: [
        { key: 'two', config: { instructions: 'PRIVATE_INSTRUCTIONS' } },
        { key: 'one', name: 'Renamed one', config: { command: 'echo PRIVATE_COMMAND' } },
      ],
    });
    expect(stored.inputs[0].defaultValue).toBe('42');
    expect(
      (
        await call(
          editDraft,
          token,
          'PATCH',
          path,
          params,
          editable,
          randomUUID(),
          response.headers.get('etag')!
        )
      ).status
    ).toBe(412);
    const ordinary = await credential(['runbooks:read']);
    expect((await call(readDraft, ordinary.token, 'GET', path, params, undefined)).status).toBe(
      403
    );
  });

  it('supports credential migration while retaining ordinary administrator compatibility', async () => {
    const legacy = await credential(['admin:manage']);
    const runbook = await createRunbook(
      { name: 'Migrating', slug: 'migrating', description: '' },
      legacy.user.id
    );
    const params = { id: runbook.id, versionId: runbook.draftVersion.id };
    const draftPath = `/runbooks/${params.id}/drafts/${params.versionId}`;
    expect((await call(readDraft, legacy.token, 'GET', draftPath, params, undefined)).status).toBe(
      403
    );
    expect(
      (
        await call(
          publishDraft,
          legacy.token,
          'POST',
          `${draftPath}/publish`,
          params,
          {},
          randomUUID(),
          '"0"'
        )
      ).status
    ).toBe(403);
    expect(
      (
        await call(
          previewRoute,
          legacy.token,
          'POST',
          `/runbooks/${params.id}/executions/preview`,
          { id: params.id },
          {}
        )
      ).status
    ).toBe(403);
    // Rotate by issuing an explicitly scoped replacement for the same identity.
    const replacementToken = `ok_test_${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await testPrisma.apiKey.create({
      data: {
        name: 'Migrated token',
        prefix: replacementToken.slice(0, 12),
        tokenHash: hashTokenV2(replacementToken),
        scopes: ['admin:manage', 'runbooks:write', 'runbooks:publish', 'runbooks:execute'],
        userId: legacy.user.id,
      },
    });
    expect(
      (await call(readDraft, replacementToken, 'GET', draftPath, params, undefined)).status
    ).toBe(200);
    expect(
      (
        await call(
          publishDraft,
          replacementToken,
          'POST',
          `${draftPath}/publish`,
          params,
          {},
          randomUUID(),
          '"0"'
        )
      ).status
    ).toBe(200);
    expect(
      (
        await call(
          previewRoute,
          replacementToken,
          'POST',
          `/runbooks/${params.id}/executions/preview`,
          { id: params.id },
          {}
        )
      ).status
    ).toBe(200);
    const service = await createTestService('Ordinary administrator compatibility');
    const incident = await createTestIncident('Resolved ordinary incident', service.id, {
      status: 'RESOLVED',
    });
    expect(
      (
        await call(
          reopen,
          legacy.token,
          'POST',
          `/incidents/${incident.id}/reopen`,
          { id: incident.id },
          {}
        )
      ).status
    ).toBe(200);
  });

  it('keeps the documented operational-only REST watcher policy even for self-follow', async () => {
    const subscriber = await credential(['incidents:read', 'incidents:write'], 'USER');
    const team = await createTestTeam('Subscribers');
    await testPrisma.teamMember.create({
      data: { teamId: team.id, userId: subscriber.user.id, role: 'MEMBER' },
    });
    const service = await createTestService('Visible service', team.id);
    const incident = await createTestIncident('Visible incident', service.id);
    const response = await call(
      addWatcher,
      subscriber.token,
      'POST',
      `/incidents/${incident.id}/watchers`,
      { id: incident.id },
      { userId: subscriber.user.id, role: 'FOLLOWER' }
    );
    expect(response.status).toBe(403);
    expect(await testPrisma.incidentWatcher.count()).toBe(0);
    expect(await testPrisma.incidentEvent.count({ where: { incidentId: incident.id } })).toBe(0);
  });

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

  it('preserves SELECT input options through validation, publication and draft cloning', async () => {
    const { token } = await credential();
    const created = await call(
      createRunbookRoute,
      token,
      'POST',
      '/runbooks',
      {},
      {
        name: 'Select inputs',
        slug: 'select-inputs',
        definition,
        inputs: [
          {
            key: 'environment',
            label: 'Environment',
            type: 'SELECT',
            defaultValue: 'staging',
            options: ['staging', 'production'],
          },
        ],
      }
    );
    expect(created.status).toBe(201);
    const runbook = (await created.json()).data;
    const params = { id: runbook.id, versionId: runbook.draftVersionId };
    const path = `/runbooks/${params.id}/drafts/${params.versionId}`;
    expect((await call(validateDraft, token, 'POST', `${path}/validate`, params, {})).status).toBe(
      200
    );
    expect(
      (
        await call(
          publishDraft,
          token,
          'POST',
          `${path}/publish`,
          params,
          {},
          'publish-select',
          '"0"'
        )
      ).status
    ).toBe(200);
    const cloned = await call(
      cloneDraft,
      token,
      'POST',
      `/runbooks/${params.id}/drafts`,
      { id: params.id },
      { sourceVersionId: params.versionId }
    );
    expect(cloned.status).toBe(201);
    const next = (await cloned.json()).data;
    const inputs = await testPrisma.runbookInput.findMany({ where: { runbookVersionId: next.id } });
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({
      type: 'SELECT',
      defaultValue: 'staging',
      options: ['staging', 'production'],
    });
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

describe('automation settings REST transaction certification', () => {
  beforeEach(async () => {
    if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
      throw new Error('Dedicated test database required');
    await resetDatabase();
  }, 120_000);

  it('requires explicit privilege and revision, with durable replay and canonical attribution', async () => {
    const admin = await credential(['admin:manage']);
    expect(
      (
        await call(
          readAutomationSettings,
          admin.token,
          'GET',
          '/settings/automation',
          {},
          undefined
        )
      ).status
    ).toBe(403);
    const authorized = await credential(['automation-settings:read', 'automation-settings:write']);
    const read = await call(
      readAutomationSettings,
      authorized.token,
      'GET',
      '/settings/automation',
      {},
      undefined
    );
    expect(read.status).toBe(200);
    expect(read.headers.get('cache-control')).toBe('no-store');
    expect(read.headers.get('etag')).toBe('"0"');
    const body = { automationEnabled: false, automationTraceRetentionDays: 90 };
    expect(
      (
        await call(
          writeAutomationSettings,
          authorized.token,
          'PATCH',
          '/settings/automation',
          {},
          body
        )
      ).status
    ).toBe(428);
    expect(
      (
        await call(
          writeAutomationSettings,
          authorized.token,
          'PATCH',
          '/settings/automation',
          {},
          body,
          randomUUID(),
          '*'
        )
      ).status
    ).toBe(400);
    const key = randomUUID();
    const first = await call(
      writeAutomationSettings,
      authorized.token,
      'PATCH',
      '/settings/automation',
      {},
      body,
      key,
      '"0"'
    );
    expect(first.status).toBe(200);
    const replay = await call(
      writeAutomationSettings,
      authorized.token,
      'PATCH',
      '/settings/automation',
      {},
      body,
      key,
      '"0"'
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    const audits = await testPrisma.auditLog.findMany({
      where: { action: 'automation.settings.updated' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      actorId: authorized.user.id,
      details: { source: 'API', metadata: { apiClientId: authorized.key.id } },
    });
    expect(JSON.stringify(audits[0])).toContain(authorized.key.id);
  });

  it('allows only one distinct-key writer for the same revision', async () => {
    const admin = await credential(['automation-settings:write']);
    const results = await Promise.all(
      [30, 60].map(days =>
        call(
          writeAutomationSettings,
          admin.token,
          'PATCH',
          '/settings/automation',
          {},
          { automationEnabled: false, automationTraceRetentionDays: days },
          randomUUID(),
          '"0"'
        )
      )
    );
    expect(results.map(result => result.status).sort()).toEqual([200, 412]);
    expect(
      await testPrisma.auditLog.count({ where: { action: 'automation.settings.updated' } })
    ).toBe(1);
  });
});

describe('automation draft REST transaction certification', () => {
  beforeEach(async () => {
    if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
      throw new Error('Dedicated test database required');
    await resetDatabase();
  }, 120_000);
  it('fences draft revisions and keeps canonical audit and durable replay atomic', async () => {
    const admin = await credential(['automation:read', 'automation:write', 'automation:publish']);
    const service = await createTestService('REST draft');
    const path = `/services/${service.id}/automation/draft`;
    const params = { id: service.id };
    const read = await call(getAutomationDraft, admin.token, 'GET', path, params, undefined);
    expect(read.status).toBe(200);
    expect(read.headers.get('etag')).toBe('"0"');
    const body = { snapshot: { schemaVersion: 1, fields: [], rules: [] } };
    const key = randomUUID();
    const saved = await call(
      saveAutomationDraft,
      admin.token,
      'PUT',
      path,
      params,
      body,
      key,
      '"0"'
    );
    expect(saved.status).toBe(200);
    expect(saved.headers.get('etag')).toBe('"1"');
    const replay = await call(
      saveAutomationDraft,
      admin.token,
      'PUT',
      path,
      params,
      body,
      key,
      '"0"'
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get('idempotency-replayed')).toBe('true');
    const changedValidatorReplay = await call(
      saveAutomationDraft,
      admin.token,
      'PUT',
      path,
      params,
      body,
      key,
      '"999"'
    );
    expect(changedValidatorReplay.status).toBe(409);
    expect(changedValidatorReplay.headers.get('idempotency-replayed')).toBeNull();

    expect(
      (await call(saveAutomationDraft, admin.token, 'PUT', path, params, body, randomUUID(), '"0"'))
        .status
    ).toBe(412);
    const audits = await testPrisma.auditLog.findMany({
      where: { action: 'automation.draft.updated' },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0].details).toMatchObject({
      source: 'API',
      metadata: { apiClientId: admin.key.id },
    });
    const published = await call(
      publishAutomationVersion,
      admin.token,
      'POST',
      `/services/${service.id}/automation/publish`,
      params,
      { expectedActiveVersionId: null },
      randomUUID(),
      '"1"'
    );
    expect(published.status).toBe(200);
    expect(published.headers.get('etag')).toBeNull();
    const active = await testPrisma.automationVersion.findFirstOrThrow({
      where: { serviceId: service.id },
    });
    await testPrisma.serviceAutomationConfig.update({
      where: { serviceId: service.id },
      data: { mode: 'LIVE' },
    });
    const candidatePublication = await call(
      publishAutomationVersion,
      admin.token,
      'POST',
      `/services/${service.id}/automation/publish`,
      params,
      { expectedActiveVersionId: active.id, expectedCandidateVersionId: null },
      randomUUID(),
      '"1"'
    );
    expect(candidatePublication.status).toBe(200);
    const candidate = (await candidatePublication.json()).data;
    expect(candidate.versionNumber).toBe(2);
    expect(
      await testPrisma.serviceAutomationConfig.findUnique({
        where: { serviceId: service.id },
      })
    ).toMatchObject({ mode: 'LIVE', activeVersionId: active.id, candidateVersionId: candidate.id });
    expect(await testPrisma.automationVersion.count({ where: { serviceId: service.id } })).toBe(2);
    const publishingAudits = await testPrisma.auditLog.findMany({
      where: { action: 'automation.version.published' },
    });
    expect(publishingAudits).toHaveLength(2);
    expect(publishingAudits[1].details).toMatchObject({
      source: 'API',
      metadata: { apiClientId: admin.key.id },
    });
    await testPrisma.apiKey.update({
      where: { id: admin.key.id },
      data: { revokedAt: new Date() },
    });
    expect(
      (await call(saveAutomationDraft, admin.token, 'PUT', path, params, body, key, '"1"')).status
    ).toBe(401);
  });
  it('serializes competing publications and rejects weak/wildcard validators and missing scopes', async () => {
    const admin = await credential(['automation:read', 'automation:write', 'automation:publish']);
    const reader = await credential(['automation:read']);
    const service = await createTestService('Competing publications');
    const params = { id: service.id };
    const draftPath = `/services/${service.id}/automation/draft`;
    const publishPath = `/services/${service.id}/automation/publish`;
    expect(
      (
        await call(
          saveAutomationDraft,
          admin.token,
          'PUT',
          draftPath,
          params,
          { snapshot: { schemaVersion: 1, fields: [], rules: [] } },
          randomUUID(),
          '"0"'
        )
      ).status
    ).toBe(200);
    const body = { expectedActiveVersionId: null };
    expect(
      (
        await call(
          publishAutomationVersion,
          reader.token,
          'POST',
          publishPath,
          params,
          body,
          randomUUID(),
          '"1"'
        )
      ).status
    ).toBe(403);
    for (const validator of ['*', 'W/"1"', '"0"']) {
      expect(
        (
          await call(
            publishAutomationVersion,
            admin.token,
            'POST',
            publishPath,
            params,
            body,
            randomUUID(),
            validator
          )
        ).status
      ).toBe(validator === '*' ? 400 : 412);
    }
    const results = await Promise.all(
      [1, 2].map(() =>
        call(
          publishAutomationVersion,
          admin.token,
          'POST',
          publishPath,
          params,
          body,
          randomUUID(),
          '"1"'
        )
      )
    );
    expect(results.map(result => result.status).sort()).toEqual([200, 412]);
    expect(await testPrisma.automationVersion.count({ where: { serviceId: service.id } })).toBe(1);
    expect(
      await testPrisma.auditLog.count({ where: { action: 'automation.version.published' } })
    ).toBe(1);
  });
  it('denies a responder outside the owning service team despite an explicit write scope', async () => {
    const responder = await credential(['automation:write'], 'RESPONDER');
    const service = await createTestService('Unrelated draft');
    const response = await call(
      saveAutomationDraft,
      responder.token,
      'PUT',
      `/services/${service.id}/automation/draft`,
      { id: service.id },
      { snapshot: { schemaVersion: 1, fields: [], rules: [] } },
      randomUUID(),
      '"0"'
    );
    expect(response.status).toBe(403);
    expect(await testPrisma.automationDraft.count()).toBe(0);
    expect(await testPrisma.auditLog.count({ where: { action: 'automation.draft.updated' } })).toBe(
      0
    );
  });
  it('blocks idempotent replay after team membership revocation or service reassignment', async () => {
    const teamA = await createTestTeam('Team Alpha');
    const teamB = await createTestTeam('Team Beta');
    const responder = await credential(['automation:write'], 'RESPONDER');
    const membership = await testPrisma.teamMember.create({
      data: { teamId: teamA.id, userId: responder.user.id },
    });
    const service = await createTestService('Owning team draft', teamA.id);
    const idempotencyKey = randomUUID();
    const draftPayload = { snapshot: { schemaVersion: 1, fields: [], rules: [] } };

    // 1. Initial write succeeds while responder is a member of Team A
    const initialResponse = await call(
      saveAutomationDraft,
      responder.token,
      'PUT',
      `/services/${service.id}/automation/draft`,
      { id: service.id },
      draftPayload,
      idempotencyKey,
      '"0"'
    );
    expect(initialResponse.status).toBe(200);

    // 2. Revoke responder's team membership
    await testPrisma.teamMember.delete({ where: { id: membership.id } });

    // 3. Replay with identical idempotency key must be rejected (403), not return cached draft
    const replayAfterRevocation = await call(
      saveAutomationDraft,
      responder.token,
      'PUT',
      `/services/${service.id}/automation/draft`,
      { id: service.id },
      draftPayload,
      idempotencyKey,
      '"0"'
    );
    expect(replayAfterRevocation.status).toBe(403);

    // 4. Re-add responder to Team A, but reassign service to Team B
    await testPrisma.teamMember.create({
      data: { teamId: teamA.id, userId: responder.user.id },
    });
    await testPrisma.service.update({
      where: { id: service.id },
      data: { teamId: teamB.id },
    });

    // 5. Replay with identical idempotency key after service reassignment must also be rejected (403)
    const replayAfterReassignment = await call(
      saveAutomationDraft,
      responder.token,
      'PUT',
      `/services/${service.id}/automation/draft`,
      { id: service.id },
      draftPayload,
      idempotencyKey,
      '"0"'
    );
    expect(replayAfterReassignment.status).toBe(403);
  });
});
