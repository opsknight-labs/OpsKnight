import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createTestOnCallSchedule,
  createTestService,
  createTestTeam,
  testPrisma as db,
} from '../helpers/test-db';
import { fixture, type Fixture } from '../helpers/mcp-approval';
import {
  describeApprovalScenarios,
  prepareKey,
  setupMcpApprovalDatabase,
  type Scenario,
} from '../helpers/mcp-approval-scenarios';
import { CostBudget } from '@/lib/mcp/core/budget';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import { commitApprovedMcpOperation, prepareMcpOperation } from '@/lib/mcp/approvals/operation';

setupMcpApprovalDatabase();

// These routes keep no stored REST receipt: the approval hook marks the approval COMMITTED in the
// route's own transaction, so a retry after the effect is always a replay of the approval.

const etag = (revision: number) => `"${revision}"`;
const unique = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

const policySteps = (policyId: string) =>
  db.escalationRule.findMany({
    where: { policyId },
    orderBy: { stepOrder: 'asc' },
    select: { stepOrder: true, targetType: true, targetUserId: true, delayMinutes: true },
  });

const scenarios: Scenario[] = [
  {
    name: 'escalation policy creation',
    operationId: 'createEscalationPolicy',
    setup: async () => ({ name: unique('Reviewed policy') }),
    input: async (f, s) => ({
      args: {
        body: {
          name: s.name,
          description: 'Created after review',
          steps: [{ targetType: 'USER', targetId: f.lead.id, delayMinutes: 5 }],
        },
      },
    }),
    effect: async (_f, s) => {
      const policies = await db.escalationPolicy.findMany({
        where: { name: s.name },
        select: { id: true, description: true },
      });
      return Promise.all(
        policies.map(async policy => [policy.description, await policySteps(policy.id)])
      );
    },
  },
  {
    name: 'escalation policy update',
    operationId: 'updateEscalationPolicy',
    setup: async f => {
      const policy = await db.escalationPolicy.create({
        data: {
          name: unique('Policy before review'),
          steps: { create: [{ stepOrder: 0, targetType: 'USER', targetUserId: f.user.id }] },
        },
      });
      return { id: policy.id, name: unique('Policy after review') };
    },
    input: async (f, s) => ({
      args: {
        path: { id: s.id },
        body: {
          name: s.name,
          steps: [{ targetType: 'USER', targetId: f.lead.id, delayMinutes: 7 }],
        },
        ifMatch: etag(
          (await db.escalationPolicy.findUniqueOrThrow({ where: { id: s.id } })).revision
        ),
      },
    }),
    effect: async (_f, s) => [
      (await db.escalationPolicy.findUniqueOrThrow({ where: { id: s.id } })).name,
      await policySteps(s.id),
    ],
    invalidate: async (_f, s) => {
      await db.escalationPolicy.update({
        where: { id: s.id },
        data: { description: 'moved on' },
      });
    },
  },
  {
    name: 'integration update',
    operationId: 'updateIntegration',
    setup: async () => {
      const service = await createTestService('Integration update');
      const integration = await db.integration.create({
        data: { name: 'Before review', key: randomUUID(), serviceId: service.id },
      });
      return { id: integration.id };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.id },
        body: { name: 'After review', enabled: false },
        ifMatch: etag((await db.integration.findUniqueOrThrow({ where: { id: s.id } })).revision),
      },
    }),
    effect: async (_f, s) => {
      const row = await db.integration.findUniqueOrThrow({ where: { id: s.id } });
      return [row.name, row.enabled];
    },
    invalidate: async (_f, s) => {
      await db.integration.update({ where: { id: s.id }, data: { name: 'Renamed out of band' } });
    },
  },
  {
    name: 'schedule update',
    operationId: 'updateSchedule',
    setup: async () => ({ id: (await createTestOnCallSchedule('Schedule update')).id }),
    input: async (_f, s) => ({
      args: {
        path: { id: s.id },
        body: { name: `Reviewed ${s.id}`, timeZone: 'Asia/Kolkata' },
        ifMatch: etag(
          (await db.onCallSchedule.findUniqueOrThrow({ where: { id: s.id } })).revision
        ),
      },
    }),
    effect: async (_f, s) => {
      const row = await db.onCallSchedule.findUniqueOrThrow({ where: { id: s.id } });
      return [row.name, row.timeZone];
    },
    invalidate: async (_f, s) => {
      await db.onCallSchedule.update({ where: { id: s.id }, data: { name: `Moved ${s.id}` } });
    },
  },
  {
    name: 'service update',
    operationId: 'updateService',
    setup: async () => ({ id: (await createTestService('Service update')).id }),
    input: async (_f, s) => ({
      args: {
        path: { id: s.id },
        body: { name: `Reviewed ${s.id}`, description: 'After review', status: 'DEGRADED' },
        ifMatch: etag((await db.service.findUniqueOrThrow({ where: { id: s.id } })).revision),
      },
    }),
    effect: async (_f, s) => {
      const row = await db.service.findUniqueOrThrow({ where: { id: s.id } });
      return [row.name, row.description, row.status];
    },
    invalidate: async (_f, s) => {
      await db.service.update({ where: { id: s.id }, data: { description: 'moved on' } });
    },
  },
  {
    name: 'team update',
    operationId: 'updateTeam',
    setup: async () => ({ id: (await createTestTeam('Team update')).id }),
    input: async (_f, s) => ({
      args: {
        path: { id: s.id },
        body: { name: `Reviewed ${s.id}`, description: 'After review' },
        ifMatch: etag((await db.team.findUniqueOrThrow({ where: { id: s.id } })).revision),
      },
    }),
    effect: async (_f, s) => {
      const row = await db.team.findUniqueOrThrow({ where: { id: s.id } });
      return [row.name, row.description];
    },
    invalidate: async (_f, s) => {
      await db.team.update({ where: { id: s.id }, data: { description: 'moved on' } });
    },
  },
];

describeApprovalScenarios(scenarios);

/** Fails the commit at the n-th budget consultation (a phase boundary); 0 never fails. */
class InterruptingBudget extends CostBudget {
  consultations = 0;
  constructor(private readonly failAt: number) {
    super();
  }
  private tick() {
    if (++this.consultations === this.failAt)
      throw new McpBoundaryError('MCP_INJECTED_FAILURE', 503);
  }
  override check() {
    this.tick();
    super.check();
  }
  override consumeResult(value: unknown) {
    this.tick();
    super.consumeResult(value);
  }
}

async function approve(f: Fixture, scenario: Scenario, s: Record<string, string>) {
  const { args } = await scenario.input(f, s);
  const approval = await prepareMcpOperation(f.ctx(), {
    operationId: scenario.operationId,
    args,
    idempotencyKey: prepareKey(),
  });
  await f.review(approval);
  return approval;
}

const committedAudits = (approvalId: string) =>
  db.auditLog.count({ where: { entityId: approvalId, action: 'mcp.operation.committed' } });
const approvalStatus = async (approvalId: string) =>
  (await db.mcpOperationApproval.findUniqueOrThrow({ where: { id: approvalId } })).status;

describe('escalation policy creation without If-Match', () => {
  const create = scenarios.find(scenario => scenario.operationId === 'createEscalationPolicy')!;
  const policiesNamed = (name: string) => db.escalationPolicy.count({ where: { name } });

  // No revision exists before a create. The frozen body binds the reviewed name, and the approval
  // is marked COMMITTED in the creating transaction, so any later commit is a replay.
  it('never applies a committed create twice, on retry or after an interrupted commit', async () => {
    const f = await fixture();
    const s = await create.setup(f);
    const approval = await approve(f, create, s);
    await commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId });
    expect(await policiesNamed(s.name)).toBe(1);
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
    ).resolves.toMatchObject({ status: 'COMMITTED', replayed: true });
    expect(await policiesNamed(s.name)).toBe(1);

    const counter = new InterruptingBudget(0);
    {
      const g = await fixture();
      const t = await create.setup(g);
      const counted = await approve(g, create, t);
      await commitApprovedMcpOperation(
        { ...g.ctx(), budget: counter },
        {
          approvalId: counted.approvalId,
        }
      );
    }
    let interruptedAfterEffect = 0;
    for (let failAt = 1; failAt <= counter.consultations; failAt++) {
      const g = await fixture();
      const t = await create.setup(g);
      const interrupted = await approve(g, create, t);
      await expect(
        commitApprovedMcpOperation(
          { ...g.ctx(), budget: new InterruptingBudget(failAt) },
          { approvalId: interrupted.approvalId }
        ),
        `failAt=${failAt}`
        // A crash inside the route's transaction surfaces as the route's own error response.
      ).rejects.toThrow(/MCP_INJECTED_FAILURE|MCP_DOMAIN_REJECTED/);
      const applied = await policiesNamed(t.name);
      expect(applied, `failAt=${failAt}`).toBeLessThanOrEqual(1);
      if (applied === 1) interruptedAfterEffect++;
      for (let retry = 0; retry < 2; retry++)
        await expect(
          commitApprovedMcpOperation(g.ctx(), { approvalId: interrupted.approvalId })
        ).resolves.toMatchObject({ status: 'COMMITTED' });
      expect(await policiesNamed(t.name), `failAt=${failAt}`).toBe(1);
      expect(await committedAudits(interrupted.approvalId), `failAt=${failAt}`).toBe(1);
    }
    expect(interruptedAfterEffect).toBeGreaterThan(0);
  });
});

describe('batch-wide', () => {
  it.each(scenarios)(
    'records $operationId as COMMITTED atomically with its effect',
    async scenario => {
      const f = await fixture();
      const s = await scenario.setup(f);
      const approval = await approve(f, scenario, s);
      await commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId });
      expect(await approvalStatus(approval.approvalId)).toBe('COMMITTED');
      expect(await committedAudits(approval.approvalId)).toBe(1);

      // Crash every later phase boundary: once the effect is visible the approval is already
      // COMMITTED with exactly one audit entry, before any follow-up transaction runs.
      const counter = new InterruptingBudget(0);
      {
        const g = await fixture();
        const t = await scenario.setup(g);
        const counted = await approve(g, scenario, t);
        await commitApprovedMcpOperation(
          { ...g.ctx(), budget: counter },
          {
            approvalId: counted.approvalId,
          }
        );
      }
      let observedAfterEffect = 0;
      for (let failAt = 1; failAt <= counter.consultations; failAt++) {
        const g = await fixture();
        const t = await scenario.setup(g);
        const before = JSON.stringify(await scenario.effect(g, t));
        const interrupted = await approve(g, scenario, t);
        await commitApprovedMcpOperation(
          { ...g.ctx(), budget: new InterruptingBudget(failAt) },
          { approvalId: interrupted.approvalId }
        ).catch(() => undefined);
        const applied = JSON.stringify(await scenario.effect(g, t)) !== before;
        expect(
          (await approvalStatus(interrupted.approvalId)) === 'COMMITTED',
          `failAt=${failAt}`
        ).toBe(applied);
        expect(await committedAudits(interrupted.approvalId), `failAt=${failAt}`).toBe(
          applied ? 1 : 0
        );
        if (applied) observedAfterEffect++;
      }
      expect(observedAfterEffect).toBeGreaterThan(0);
    }
  );

  it('keeps every batch operation out of generic dispatch', async () => {
    const { callMcpOperation } = await import('@/lib/mcp/core/execution');
    const f = await fixture();
    const team = await createTestTeam('Generic');
    for (const scenario of scenarios)
      await expect(
        callMcpOperation(f.ctx(), scenario.operationId, {
          path: { id: team.id },
          body: {},
          idempotencyKey: 'generic-dispatch-attempt-1',
          ifMatch: '"1"',
        })
      ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
  });
});
