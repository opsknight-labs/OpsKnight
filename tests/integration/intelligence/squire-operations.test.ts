import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  buildOperationProposal,
  buildOperationTools,
  searchOperations,
  squireOperation,
} from '@/lib/intelligence/squire/operations';
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
  it('reaches operational changes but never credentials, settings or R3 operations', async () => {
    const { admin, stakeholder } = await world();
    expect(squireOperation('createScheduleOverride')).not.toBeNull();
    expect(squireOperation('updateChatOpsConfiguration')).toBeNull();
    expect(squireOperation('updateIntegration')).toBeNull();
    expect(squireOperation('deleteService')).toBeNull();
    expect(squireOperation('rotateIntegrationCredentials')).toBeNull();
    const found = searchOperations(admin, 'create a maintenance window for a service');
    expect(found.map(item => item.operationId)).toContain('createMaintenanceWindow');
    // A role that may change nothing is offered no change.
    expect(
      searchOperations(stakeholder, 'update the service').filter(item => item.kind === 'change')
    ).toEqual([]);
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
      label: 'name',
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
    expect(undo.preview).toContainEqual({ label: 'name', value: `Checkout v2 → ${service.name}` });
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
