import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import {
  buildPlanProposal,
  executePlanProposal,
  openPlanProposal,
} from '@/lib/intelligence/squire/plans';
import { executeSquireAction } from '@/lib/intelligence/squire/actions/execute';
import {
  createTestEscalationPolicy,
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

const HOUR = 3_600_000;

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
  const admin = await createTestUser({ role: 'ADMIN', name: 'Plan Admin' });
  const stakeholder = await createTestUser({ role: 'STAKEHOLDER', name: 'Plan Stakeholder' });
  const team = await createTestTeam('Platform');
  const policy = await createTestEscalationPolicy('Platform policy', []);
  const service = await createTestService('Checkout', team.id);
  return {
    admin: (await resolveUserActor(admin.id))!,
    stakeholder: (await resolveUserActor(stakeholder.id))!,
    team,
    policy,
    service,
  };
}

const window = (serviceId: unknown) => ({
  operationId: 'createMaintenanceWindow',
  args: {
    body: {
      title: 'Cut-over',
      serviceIds: [serviceId],
      startsAt: new Date(Date.now() + HOUR).toISOString(),
      endsAt: new Date(Date.now() + 2 * HOUR).toISOString(),
    },
  },
});

function createThenWindow(teamId: string, policyId: string, ref: unknown) {
  return {
    title: 'New payments service',
    steps: [
      {
        operationId: 'createService',
        args: { body: { name: 'Payments', teamId, escalationPolicyId: policyId } },
      },
      window(ref),
    ],
  };
}

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
  await settings(true);
});

describe('Squire change plans', () => {
  it('applies every step in order, feeding a new record into the next step, exactly once', async () => {
    const { admin, team, policy } = await world();
    const proposal = await buildPlanProposal(
      admin,
      createThenWindow(team.id, policy.id, { $from: '0', pointer: '/data/id' })
    );
    expect(proposal).toMatchObject({
      action: 'run_plan',
      title: 'Plan: New payments service',
      confirmLabel: 'Apply all',
    });
    expect(proposal!.detail).toContain('stops at the first failure');
    expect(proposal!.preview).toHaveLength(2);
    expect(proposal!.preview![0].label).toMatch(/^Step 1 · /);
    expect(proposal!.preview![1].value).toContain('from-step-1');
    // Only a card so far.
    expect(await db.service.count({ where: { name: 'Payments' } })).toBe(0);

    const result = await executeSquireAction(admin, proposal!.token);
    expect(result.ok, result.message).toBe(true);
    expect(result.message).toMatch(/^Done: step 1 .*, step 2 /);
    const created = await db.service.findFirstOrThrow({ where: { name: 'Payments' } });
    const windows = await db.maintenanceWindow.findMany({ include: { services: true } });
    expect(windows).toHaveLength(1);
    expect(JSON.stringify(windows[0])).toContain(created.id);
    const receipt = await db.squireActionReceipt.findUniqueOrThrow({
      where: { id: proposal!.receiptId! },
    });
    expect(receipt).toMatchObject({ action: 'plan:2 steps', status: 'SUCCEEDED' });

    const replay = await executeSquireAction(admin, proposal!.token);
    expect(replay.ok).toBe(false);
    expect(await db.service.count({ where: { name: 'Payments' } })).toBe(1);
  });

  it('stops at the first refused step and reports what was done and what was not', async () => {
    const { admin, team, policy, service } = await world();
    const proposal = await buildPlanProposal(admin, {
      title: 'Rename and window',
      steps: [
        {
          operationId: 'updateService',
          args: { path: { id: service.id }, body: { name: 'Checkout v2' } },
        },
        // Valid in shape, but the service does not exist when it runs.
        window('missing-service-id'),
        createThenWindow(team.id, policy.id, 'x').steps[0],
      ],
    });
    expect(proposal).not.toBeNull();
    const result = await executeSquireAction(admin, proposal!.token);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Done: step 1');
    expect(result.message).toContain('Failed: step 2');
    expect(result.message).toContain('Not attempted: step 3');
    expect(result.message).toContain('not rolled back');
    expect((await db.service.findUniqueOrThrow({ where: { id: service.id } })).name).toBe(
      'Checkout v2'
    );
    expect(await db.service.count({ where: { name: 'Payments' } })).toBe(0);
    expect(
      await db.squireActionReceipt.findUniqueOrThrow({ where: { id: proposal!.receiptId! } })
    ).toMatchObject({ status: 'FAILED' });
  });

  it('offers no card when extended actions are off, for a role that cannot, or for a bad $from', async () => {
    const { admin, stakeholder, team, policy } = await world();
    const good = createThenWindow(team.id, policy.id, { $from: '0', pointer: '/data/id' });
    expect(await buildPlanProposal(stakeholder, good)).toBeNull();
    // A reference to itself or a later step, a malformed pointer, or extra keys.
    for (const ref of [
      { $from: '1', pointer: '/data/id' },
      { $from: '0', pointer: 'data/id' },
      { $from: '0', pointer: '/data/id', extra: 1 },
    ])
      expect(await buildPlanProposal(admin, createThenWindow(team.id, policy.id, ref))).toBeNull();
    // A single step is not a plan.
    expect(await buildPlanProposal(admin, { ...good, steps: good.steps.slice(0, 1) })).toBeNull();

    const proposal = await buildPlanProposal(admin, good);
    expect(proposal).not.toBeNull();
    await settings(false);
    expect(await buildPlanProposal(admin, good)).toBeNull();
    // Switching extended actions off withdraws open cards too.
    expect((await executeSquireAction(admin, proposal!.token)).ok).toBe(false);
    expect(await db.service.count({ where: { name: 'Payments' } })).toBe(0);
  });

  it('keeps high-risk changes out of plans, and never lets a reference pick the target of an update', async () => {
    const { admin, team, policy, service } = await world();
    const create = createThenWindow(team.id, policy.id, 'x').steps[0];
    // A delete always gets its own card.
    expect(
      await buildPlanProposal(admin, {
        title: 'Create and delete',
        steps: [create, { operationId: 'deleteService', args: { path: { id: service.id } } }],
      })
    ).toBeNull();
    // An update whose target comes from an earlier step would show no real id on the card.
    expect(
      await buildPlanProposal(admin, {
        title: 'Create and rename',
        steps: [
          create,
          {
            operationId: 'updateService',
            args: { path: { id: { $from: '0', pointer: '/data/id' } }, body: { name: 'Renamed' } },
          },
        ],
      })
    ).toBeNull();
    // The same update on a real id is fine.
    expect(
      await buildPlanProposal(admin, {
        title: 'Create and rename',
        steps: [
          create,
          {
            operationId: 'updateService',
            args: { path: { id: service.id }, body: { name: 'Checkout v2' } },
          },
        ],
      })
    ).not.toBeNull();
  });

  it('records the incident a plan changes on its receipt', async () => {
    const { admin, service } = await world();
    const incident = await createTestIncident('Checkout errors', service.id);
    const proposal = await buildPlanProposal(admin, {
      title: 'Rename and tag',
      steps: [
        {
          operationId: 'updateService',
          args: { path: { id: service.id }, body: { name: 'Checkout v2' } },
        },
        {
          operationId: 'addIncidentTag',
          args: { path: { id: incident.id }, body: { name: 'database' } },
        },
      ],
    });
    const result = await executeSquireAction(admin, proposal!.token);
    expect(result.ok, result.message).toBe(true);
    expect(
      (await db.squireActionReceipt.findUniqueOrThrow({ where: { id: proposal!.receiptId! } }))
        .incidentId
    ).toBe(incident.id);
  });

  it('says a receipt that cannot be written was not recorded, and only a reused card was already used', async () => {
    const { admin, team, policy } = await world();
    const good = createThenWindow(team.id, policy.id, { $from: '0', pointer: '/data/id' });
    const ghost = (await openPlanProposal(
      (await buildPlanProposal(admin, good))!.token,
      admin.id
    ))!;
    // No such person: the receipt fails on its foreign key, which is not "already used".
    expect(await executePlanProposal({ ...admin, id: 'no-such-user' }, ghost)).toEqual({
      ok: false,
      message: expect.stringMatching(/could not be recorded/),
    });
    expect(await db.service.count({ where: { name: 'Payments' } })).toBe(0);
    const proposal = await buildPlanProposal(admin, good);
    expect((await executeSquireAction(admin, proposal!.token)).ok).toBe(true);
    expect(await executeSquireAction(admin, proposal!.token)).toEqual({
      ok: false,
      message: expect.stringMatching(/already used/),
    });
  });
});
