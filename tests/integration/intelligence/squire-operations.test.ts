import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  buildOperationProposal,
  buildOperationTools,
  executeOperationProposal,
  openOperationProposal,
  searchOperations,
  squireOperation,
} from '@/lib/intelligence/squire/operations';
import {
  buildRunbookFromFixProposal,
  buildRunbookStepsProposal,
} from '@/lib/intelligence/squire/plans';
import { buildIncidentTools } from '@/lib/intelligence/squire/tools-incident';
import { executeSquireAction } from '@/lib/intelligence/squire/actions/execute';
import { readSquireActionOutcome } from '@/lib/intelligence/squire/actions/outcomes';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

async function settings(extendedActions: boolean) {
  await db.aiSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      enabled: true,
      squireEnabled: true,
      squireExtendedActions: extendedActions,
      updatedAt: new Date(),
    },
    update: { squireExtendedActions: extendedActions },
  });
}

async function world() {
  const admin = await createTestUser({ role: 'ADMIN', name: 'Op Admin' });
  const stakeholder = await createTestUser({ role: 'STAKEHOLDER', name: 'Op Stakeholder' });
  const team = await createTestTeam('Operations');
  const service = await createTestService('Checkout', team.id);
  const incident = await createTestIncident('Checkout errors', service.id, { teamId: team.id });
  return {
    admin: (await resolveUserActor(admin.id))!,
    stakeholder: (await resolveUserActor(stakeholder.id))!,
    service,
    incident,
  };
}

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  await settings(true);
});

describe('Squire operation catalog', () => {
  it('reaches operational changes and reviewed high-risk ones, never credentials, settings or denied operations', async () => {
    const { admin, stakeholder } = await world();
    expect(squireOperation('createScheduleOverride')).not.toBeNull();
    expect(squireOperation('updateChatOpsConfiguration')).toBeNull();
    expect(squireOperation('updateIntegration')).toBeNull();
    // A reviewed R3 change (impact preview) is reachable as a high-risk card; a denied R3 one never is.
    expect(squireOperation('deleteService')).not.toBeNull();
    expect(squireOperation('deleteServiceAccount')).toBeNull();
    expect(squireOperation('rotateIntegrationCredentials')).toBeNull();
    const found = searchOperations(admin, 'create a maintenance window for a service');
    expect(found.map(item => item.operationId)).toContain('createMaintenanceWindow');
    // A role that may change nothing sees changes only as not allowed, with the role that could.
    const changes = searchOperations(stakeholder, 'update the service').filter(
      item => item.kind === 'change'
    );
    expect(changes.length).toBeGreaterThan(0);
    for (const item of changes) {
      expect(item).toMatchObject({ allowed: false });
      expect(item.needsRole).toMatch(/Admin/);
    }
  });

  it('proposes a change with a before/after diff, applies it once on confirmation, and records the outcome', async () => {
    const { admin, service } = await world();
    const proposal = await buildOperationProposal(admin, {
      operationId: 'updateService',
      args: { path: { id: service.id }, body: { name: 'Checkout v2' } },
    });
    expect(proposal).not.toBeNull();
    expect(proposal!.incidentId).toBeUndefined();
    expect(proposal!.href).toBe(`/services/${service.id}`);
    expect(proposal!.preview).toContainEqual({
      label: 'Name',
      value: `${service.name} → Checkout v2`,
    });
    // Nothing changed yet: a proposal is only a card.
    expect((await db.service.findUnique({ where: { id: service.id } }))!.name).toBe(service.name);

    const result = await executeSquireAction(admin, proposal!.token);
    expect(result).toMatchObject({ ok: true, href: `/services/${service.id}` });
    expect((await db.service.findUnique({ where: { id: service.id } }))!.name).toBe('Checkout v2');
    expect(await readSquireActionOutcome(admin, proposal!.receiptId!)).toMatchObject({
      status: 'SUCCEEDED',
    });

    const replay = await executeSquireAction(admin, proposal!.token);
    expect(replay.ok).toBe(false);
  });

  it('offers a reopen card for a resolved incident, and reopens it only on confirmation', async () => {
    const { admin, incident } = await world();
    await db.incident.update({
      where: { id: incident.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
    // Models often leave out the empty body of a command; the card is still built.
    const proposal = await buildOperationProposal(admin, {
      operationId: 'reopenIncident',
      args: { path: { id: incident.id } },
    });
    expect(proposal).not.toBeNull();
    expect((await db.incident.findUnique({ where: { id: incident.id } }))!.status).toBe('RESOLVED');
    expect(await executeSquireAction(admin, proposal!.token)).toMatchObject({ ok: true });
    expect((await db.incident.findUnique({ where: { id: incident.id } }))!.status).not.toBe(
      'RESOLVED'
    );
  });

  it('applies a routine incident change (a tag) as the person', async () => {
    const { admin, incident } = await world();
    const proposal = await buildOperationProposal(admin, {
      operationId: 'addIncidentTag',
      args: { path: { id: incident.id }, body: { name: 'database' } },
    });
    expect((await executeSquireAction(admin, proposal!.token)).ok).toBe(true);
    const tags = await db.incidentTag.findMany({
      where: { incidentId: incident.id },
      include: { tag: true },
    });
    expect(tags.map(row => row.tag.name)).toContain('database');
  });

  it('offers nothing when extended actions are off, or for a role that may not change it, or for invalid input', async () => {
    const { admin, stakeholder, service } = await world();
    const input = {
      operationId: 'updateService',
      args: { path: { id: service.id }, body: { name: 'Nope' } },
    };
    expect(await buildOperationProposal(stakeholder, input)).toBeNull();
    expect(
      await buildOperationProposal(admin, {
        operationId: 'updateService',
        args: { path: { id: service.id }, body: { unknownField: 1 } },
      })
    ).toBeNull();
    const proposal = await buildOperationProposal(admin, input);
    await settings(false);
    expect(await buildOperationProposal(admin, input)).toBeNull();
    // Switching extended actions off withdraws open cards too.
    expect((await executeSquireAction(admin, proposal!.token)).ok).toBe(false);
    expect((await db.service.findUnique({ where: { id: service.id } }))!.name).toBe(service.name);
  });

  it('refuses a card someone else confirms, and from chat', async () => {
    const { admin, service } = await world();
    const other = (await resolveUserActor((await createTestUser({ role: 'ADMIN' })).id))!;
    const proposal = await buildOperationProposal(admin, {
      operationId: 'updateService',
      args: { path: { id: service.id }, body: { name: 'Stolen' } },
    });
    expect((await executeSquireAction(other, proposal!.token)).ok).toBe(false);
    expect(
      (
        await executeSquireAction(admin, proposal!.token, {
          provider: 'SLACK',
        } as Parameters<typeof executeSquireAction>[2])
      ).ok
    ).toBe(false);
    expect((await db.service.findUnique({ where: { id: service.id } }))!.name).toBe(service.name);
  });

  it('verifies a rename after it lands and offers a sealed undo that restores the old name', async () => {
    const { admin, service } = await world();
    const proposal = await buildOperationProposal(admin, {
      operationId: 'updateService',
      args: { path: { id: service.id }, body: { name: 'Checkout v2' } },
    });
    const result = await executeSquireAction(admin, proposal!.token);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message).toContain('Now: name = Checkout v2');
    const undo = result.followUp!;
    expect(undo).toMatchObject({
      title: expect.stringMatching(/^Undo: /),
      confirmLabel: 'Undo',
      href: `/services/${service.id}`,
    });
    expect(undo.incidentId).toBeUndefined();
    expect(undo.preview).toContainEqual({ label: 'Name', value: `Checkout v2 → ${service.name}` });
    // The stored outcome keeps the undo card (an operation follow-up has no incident).
    expect(await readSquireActionOutcome(admin, proposal!.receiptId!)).toMatchObject({
      result: { followUp: { token: undo.token, confirmLabel: 'Undo' } },
    });

    expect((await executeSquireAction(admin, undo.token)).ok).toBe(true);
    expect((await db.service.findUnique({ where: { id: service.id } }))!.name).toBe(service.name);
    // Single use, like every card.
    expect((await executeSquireAction(admin, undo.token)).ok).toBe(false);
  });

  it('undoes an added tag by removing it', async () => {
    const { admin, incident } = await world();
    const proposal = await buildOperationProposal(admin, {
      operationId: 'addIncidentTag',
      args: { path: { id: incident.id }, body: { name: 'database' } },
    });
    const result = await executeSquireAction(admin, proposal!.token);
    expect(result.ok && result.followUp).toBeTruthy();
    if (!result.ok) return;
    expect((await executeSquireAction(admin, result.followUp!.token)).ok).toBe(true);
    expect(await db.incidentTag.count({ where: { incidentId: incident.id } })).toBe(0);
  });

  it('offers no undo to a person whose role cannot make the inverse change', async () => {
    const { admin, service } = await world();
    const user = await createTestUser({ role: 'USER', name: 'Op Responder' });
    const responder = (await resolveUserActor(user.id))!;
    const mine = await createTestIncident('Assigned to me', service.id, { assigneeId: user.id });
    const theirs = await createTestIncident('Admin acks', service.id);
    const ack = (actor: typeof admin, id: string) =>
      buildOperationProposal(actor, {
        operationId: 'acknowledgeIncident',
        args: { path: { id }, body: {} },
      });
    const asAdmin = await executeSquireAction(admin, (await ack(admin, theirs.id))!.token);
    expect(asAdmin.ok && asAdmin.followUp?.confirmLabel).toBe('Undo');
    // A responder may acknowledge their own incident but not unacknowledge it (incident.manage).
    const asResponder = await executeSquireAction(
      responder,
      (await ack(responder, mine.id))!.token
    );
    expect(asResponder.ok).toBe(true);
    expect(asResponder.ok && asResponder.followUp).toBeFalsy();
  });

  it("never offers deciding someone else's request (approve or reject) as a card", async () => {
    const { admin } = await world();
    for (const id of ['approveRunbookExecutionStep', 'rejectRunbookExecutionStep'])
      expect(squireOperation(id)).toBeNull();
    const found = searchOperations(admin, 'approve reject runbook execution step', 50);
    expect(found.map(item => item.operationId)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(approve|reject)[A-Z]/)])
    );
  });

  it('offers no undo that would clear a state the incident already had before the change', async () => {
    const { admin, service } = await world();
    const run = async (operationId: string, id: string) => {
      const proposal = await buildOperationProposal(admin, {
        operationId,
        args: { path: { id }, body: {} },
      });
      expect(proposal, operationId).not.toBeNull();
      const result = await executeSquireAction(admin, proposal!.token);
      expect(result.ok, result.message).toBe(true);
      return result.ok ? result.followUp : undefined;
    };
    // From OPEN, the undo returns it to OPEN.
    const open = await createTestIncident('Open one', service.id);
    expect(await run('acknowledgeIncident', open.id)).toMatchObject({ confirmLabel: 'Undo' });
    const suppressed = await createTestIncident('Open two', service.id);
    expect(await run('suppressIncident', suppressed.id)).toMatchObject({ confirmLabel: 'Undo' });
    // Already in that state: the change did nothing, so there is nothing to undo.
    const acked = await createTestIncident('Already acked', service.id);
    await db.incident.update({ where: { id: acked.id }, data: { status: 'ACKNOWLEDGED' } });
    expect(await run('acknowledgeIncident', acked.id)).toBeUndefined();
    expect((await db.incident.findUniqueOrThrow({ where: { id: acked.id } })).status).toBe(
      'ACKNOWLEDGED'
    );
    const already = await createTestIncident('Already suppressed', service.id);
    await db.incident.update({ where: { id: already.id }, data: { status: 'SUPPRESSED' } });
    expect(await run('suppressIncident', already.id)).toBeUndefined();
  });

  it('records the incident on an incident change receipt, and nothing for other domains', async () => {
    const { admin, service, incident } = await world();
    const tag = await buildOperationProposal(admin, {
      operationId: 'addIncidentTag',
      args: { path: { id: incident.id }, body: { name: 'database' } },
    });
    const rename = await buildOperationProposal(admin, {
      operationId: 'updateService',
      args: { path: { id: service.id }, body: { name: 'Checkout v2' } },
    });
    for (const proposal of [tag, rename])
      expect((await executeSquireAction(admin, proposal!.token)).ok).toBe(true);
    const receipt = (id: string) => db.squireActionReceipt.findUniqueOrThrow({ where: { id } });
    expect(await receipt(tag!.receiptId!)).toMatchObject({
      incidentId: incident.id,
      incidentIds: [incident.id],
    });
    expect(await receipt(rename!.receiptId!)).toMatchObject({ incidentId: null, incidentIds: [] });
  });

  it('offers a fix → runbook card after a resolve, drafted from the timeline and Squire actions', async () => {
    const { admin, incident } = await world();
    const tag = await buildOperationProposal(admin, {
      operationId: 'addIncidentTag',
      args: { path: { id: incident.id }, body: { name: 'database' } },
    });
    expect((await executeSquireAction(admin, tag!.token)).ok).toBe(true);
    // What a person wrote is the note; its timeline event only says who added one.
    await db.incidentNote.create({
      data: { incidentId: incident.id, content: 'Restarted the connection pool' },
    });
    await db.incidentEvent.create({
      data: { incidentId: incident.id, type: 'COMMENT', message: 'Note added by Op Admin' },
    });
    // Not resolved yet: nothing to turn into a runbook.
    expect(await buildRunbookFromFixProposal(admin, { incidentId: incident.id })).toMatchObject({
      refusal: expect.stringContaining('resolved incident'),
    });

    const resolve = await buildOperationProposal(admin, {
      operationId: 'resolveIncident',
      args: { path: { id: incident.id }, body: { resolutionNote: 'Pool size raised to 50' } },
    });
    const resolved = await executeSquireAction(admin, resolve!.token);
    expect(resolved.ok).toBe(true);
    const card = resolved.ok ? resolved.followUp : undefined;
    expect(card).toMatchObject({
      title: 'Turn this fix into a runbook',
      confirmLabel: 'Create draft runbook',
    });
    const steps = card!.preview!.map(row => row.value);
    expect(steps[0]).toContain('Confirm the symptom');
    expect(steps).toContain('Add a tag to an incident');
    expect(steps).toContain('Restarted the connection pool');
    expect(steps.at(-1)).toMatch(/^Confirm the fix holds: Pool size raised to 50$/);
    expect(steps.join('\n')).not.toMatch(/Note added by|Resolution note added/);
    // The steps quote notes people wrote.
    expect(card!.untrustedContext).toBe(true);
    // Only a card: no runbook until it is confirmed, then an unpublished draft with those steps.
    expect(await db.runbook.count()).toBe(0);
    expect((await executeSquireAction(admin, card!.token)).ok).toBe(true);
    const runbook = await db.runbook.findFirstOrThrow({ include: { draftVersion: true } });
    expect(runbook).toMatchObject({ name: `Fix: ${incident.title}`, publishedVersionId: null });
    const definition = runbook.draftVersion!.definition as {
      steps: { name: string; type: string }[];
    };
    expect(definition.steps.map(step => step.type)).toEqual(steps.map(() => 'MANUAL'));
    expect(definition.steps.map(step => step.name)).toContain('Restarted the connection pool');
  });

  it('offers no runbook after a resolve with nothing done but the resolution note', async () => {
    const { admin, incident } = await world();
    const resolve = await buildOperationProposal(admin, {
      operationId: 'resolveIncident',
      args: { path: { id: incident.id }, body: { resolutionNote: 'Stale alert, closing' } },
    });
    const resolved = await executeSquireAction(admin, resolve!.token);
    expect(resolved.ok).toBe(true);
    expect(resolved.ok && resolved.followUp).toBeFalsy();
  });

  it('binds a revision-checked change to the revision it read, and describes it in words', async () => {
    const { admin, service } = await world();
    const proposal = await buildOperationProposal(admin, {
      operationId: 'updateService',
      // A guessed revision: the card uses the one it read instead.
      args: { path: { id: service.id }, body: { description: 'Checkout API' }, ifMatch: '"999"' },
    });
    expect(proposal!.detail).toBe(`On “${service.name}”. Runs as you, with your permissions.`);
    expect((await executeSquireAction(admin, proposal!.token)).ok).toBe(true);
    // A change since the card was made is refused, never applied over it.
    const stale = await buildOperationProposal(admin, {
      operationId: 'updateService',
      args: { path: { id: service.id }, body: { description: 'Stale' } },
    });
    await db.service.update({ where: { id: service.id }, data: { description: 'Changed' } });
    expect(await executeSquireAction(admin, stale!.token)).toMatchObject({
      ok: false,
      message: expect.stringContaining('changed since'),
    });
  });

  it("shows and changes a draft-only runbook's steps through its draft, never its configuration", async () => {
    const { admin, stakeholder } = await world();
    const responder = (await resolveUserActor(
      (await createTestUser({ role: 'RESPONDER', name: 'Op Responder' })).id
    ))!;
    const runbook = await db.runbook.create({ data: { name: 'Failed run', slug: 'failed-run' } });
    const draft = await db.runbookVersion.create({
      data: {
        runbookId: runbook.id,
        version: 1,
        state: 'DRAFT',
        checksum: 'test',
        draftRevision: 4,
        definition: {
          steps: [
            {
              key: 'open-run',
              name: 'Open the failed run',
              type: 'MANUAL',
              riskClass: 'READ_ONLY',
              config: { secretNote: 'do-not-show' },
            },
          ],
        },
      },
    });
    await db.runbook.update({ where: { id: runbook.id }, data: { draftVersionId: draft.id } });
    const steps = (actor: typeof admin) =>
      buildIncidentTools(actor, { personal: false }).find(
        tool => tool.name === 'get_runbook_steps'
      )!.execute!({ id: runbook.id });
    const read = await steps(admin);
    expect(read).toMatchObject({
      steps: [],
      draft: { revision: 4, steps: [{ name: 'Open the failed run', type: 'MANUAL' }] },
    });
    expect(JSON.stringify(read)).not.toContain('do-not-show');
    // A role that may read runbooks but not manage them sees no draft, as in the runbook editor.
    expect(await steps(responder)).not.toHaveProperty('draft');

    const card = await buildRunbookStepsProposal(admin, {
      runbookId: runbook.id,
      steps: [
        { name: 'Open the failed run' },
        { name: 'Retry the run', description: 'Retry it once.' },
      ],
      mode: 'replace',
    });
    expect(card).toMatchObject({
      title: 'Update the draft steps of “Failed run”',
      confirmLabel: 'Save draft steps',
      href: `/runbooks/${runbook.id}`,
      preview: [
        { label: 'Step 1', value: 'Open the failed run' },
        { label: 'Step 2', value: 'Retry the run — Retry it once.' },
      ],
    });
    expect(JSON.stringify(card)).not.toMatch(/PATCH|definition\.steps/);
    const result = await executeSquireAction(admin, (card as { token: string }).token);
    expect(result.ok, result.message).toBe(true);
    const saved = await db.runbookVersion.findUniqueOrThrow({ where: { id: draft.id } });
    expect(saved.draftRevision).toBe(5);
    // The kept step keeps its key and its configuration (restored by the route, never on the card).
    expect((saved.definition as { steps: unknown[] }).steps).toMatchObject([
      { key: 'open-run', name: 'Open the failed run', config: { secretNote: 'do-not-show' } },
      { name: 'Retry the run', description: 'Retry it once.', type: 'MANUAL' },
    ]);

    expect(
      await buildRunbookStepsProposal(stakeholder, {
        runbookId: runbook.id,
        steps: [{ name: 'x' }],
      })
    ).toEqual({ refusal: expect.stringMatching(/needs .*Admin/) });
    await db.runbook.update({ where: { id: runbook.id }, data: { draftVersionId: null } });
    expect(
      await buildRunbookStepsProposal(admin, { runbookId: runbook.id, steps: [{ name: 'x' }] })
    ).toEqual({ refusal: expect.stringContaining(`has no unpublished draft`) });
  });

  it('lets the model refine the runbook steps, and names the role a person needs to create one', async () => {
    const { admin, stakeholder, incident } = await world();
    await db.incident.update({ where: { id: incident.id }, data: { status: 'RESOLVED' } });
    const refined = await buildRunbookFromFixProposal(admin, {
      incidentId: incident.id,
      name: 'Checkout pool exhaustion',
      steps: [{ name: 'Raise the pool size', description: 'Set it to 50.' }],
    });
    expect(refined).toMatchObject({
      preview: [{ label: 'Step 1', value: 'Raise the pool size: Set it to 50.' }],
    });
    const refusal = await buildRunbookFromFixProposal(stakeholder, { incidentId: incident.id });
    expect(refusal).toEqual({ refusal: expect.stringMatching(/needs .*Admin/) });
    expect(await db.runbook.count()).toBe(0);
  });

  it('reports a receipt that cannot be written as not recorded, and only a duplicate as already used', async () => {
    const { admin, service } = await world();
    const input = {
      operationId: 'updateService',
      args: { path: { id: service.id }, body: { name: 'Checkout v2' } },
    };
    const proposal = await buildOperationProposal(admin, input);
    // A receipt for a person who no longer exists fails on its foreign key, not as a duplicate.
    const ghost = await buildOperationProposal(admin, input);
    const sealed = (await openOperationProposal(ghost!.token, admin.id))!;
    const missing = await executeOperationProposal(
      { ...admin, id: 'no-such-user' },
      {
        ...sealed,
        actorId: 'no-such-user',
      }
    );
    expect(missing).toEqual({ ok: false, message: expect.stringMatching(/could not be recorded/) });
    expect((await executeSquireAction(admin, proposal!.token)).ok).toBe(true);
    const replay = await executeSquireAction(admin, proposal!.token);
    expect(replay).toEqual({ ok: false, message: expect.stringMatching(/already used/) });
  });

  it('stops a catalog read once the turn is stopped', async () => {
    const { admin, service } = await world();
    const controller = new AbortController();
    controller.abort();
    const read = buildOperationTools(admin, { signal: controller.signal }).find(
      tool => tool.name === 'read_operation'
    )!;
    const result = (await read.execute!({
      operationId: 'getService',
      args: { path: { id: service.id } },
    })) as { data?: unknown; error?: string };
    expect(result.data).toBeUndefined();
    expect(result.error).toBeTruthy();
  });

  it('reads through the catalog with the field allowlist applied', async () => {
    const { admin, service } = await world();
    const read = buildOperationTools(admin).find(tool => tool.name === 'read_operation')!;
    const result = (await read.execute!({
      operationId: 'getService',
      args: { path: { id: service.id } },
    })) as { data?: unknown; error?: string };
    expect(result.error).toBeUndefined();
    expect(JSON.stringify(result.data)).toContain(service.name);
    expect(
      await read.execute!({ operationId: 'updateService', args: { path: { id: service.id } } })
    ).toHaveProperty('error');
  });
});
