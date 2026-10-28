import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createTestOnCallSchedule,
  createTestService,
  createTestTeam,
  createTestUser,
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
import { MCP_APPROVAL_HANDLERS } from '@/lib/mcp/operations/handlers';

setupMcpApprovalDatabase();

// These routes keep no stored REST receipt: the approval hook marks the approval COMMITTED in the
// route's own transaction, so a retry after the effect is always a replay of the approval.

const etag = (revision: number) => `"${revision}"`;
const unique = (label: string) => `${label} ${randomUUID().slice(0, 8)}`;

const overrideWindow = {
  startDate: '2026-11-01T00:00:00.000Z',
  endDate: '2026-11-01T08:00:00.000Z',
};
const overridesInWindow = (f: Fixture, s: Record<string, string>) =>
  db.onCallOverride.count({
    where: {
      scheduleId: s.id,
      userId: f.lead.id,
      start: new Date(overrideWindow.startDate),
      end: new Date(overrideWindow.endDate),
    },
  });

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
  {
    name: 'schedule override creation',
    operationId: 'createScheduleOverride',
    setup: async () => ({ id: (await createTestOnCallSchedule('Override creation')).id }),
    input: async (f, s) => ({
      args: { path: { id: s.id }, body: { userId: f.lead.id, ...overrideWindow } },
    }),
    effect: overridesInWindow,
  },
  {
    name: 'status page creation',
    operationId: 'createStatusPage',
    // One status page per account: the fixture's own page would otherwise exhaust the limit.
    setup: async () => {
      await db.statusPage.deleteMany();
      return { name: unique('Reviewed status'), slug: `reviewed-${randomUUID().slice(0, 8)}` };
    },
    input: async (_f, s) => ({ args: { body: { name: s.name, slug: s.slug } } }),
    effect: async (_f, s) =>
      db.statusPage.findMany({ where: { slug: s.slug }, select: { name: true, slug: true } }),
  },
  {
    name: 'notification retry',
    operationId: 'retryNotification',
    setup: async () => {
      const recipient = await createTestUser({ role: 'RESPONDER' });
      const notification = await db.notification.create({
        data: {
          userId: recipient.id,
          channel: 'EMAIL',
          status: 'FAILED',
          attempts: 1,
          maxAttempts: 3,
          payloadEncrypted: 'v1:encrypted-placeholder',
          failedAt: new Date(),
          errorMsg: 'provider unavailable',
        },
      });
      return { id: notification.id };
    },
    input: async (_f, s) => ({ args: { path: { id: s.id } } }),
    effect: async (_f, s) =>
      (await db.notification.findUniqueOrThrow({ where: { id: s.id } })).status,
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

describe('receipt-less creates and requeues without a revision precondition', () => {
  // Neither has an If-Match revision: the conflict check inside the effect's own transaction is
  // what turns state that changed after review into a definitive refusal.
  const natural: Array<{
    operationId: string;
    conflict: string;
    /** Puts the target into a state the reviewed change can no longer apply to. */
    preempt(f: Fixture, s: Record<string, string>): Promise<unknown>;
    /** Effects applied by the route and its own audit rows for them. */
    applied(f: Fixture, s: Record<string, string>): Promise<{ effects: number; audits: number }>;
  }> = [
    {
      operationId: 'createScheduleOverride',
      conflict: 'the same override created out of band',
      preempt: (f, s) =>
        db.onCallOverride.create({
          data: {
            scheduleId: s.id,
            userId: f.lead.id,
            start: new Date(overrideWindow.startDate),
            end: new Date(overrideWindow.endDate),
          },
        }),
      applied: async (f, s) => ({
        effects: await overridesInWindow(f, s),
        audits: await db.auditLog.count({
          where: { action: 'schedule_override.created', entityId: s.id },
        }),
      }),
    },
    {
      operationId: 'createStatusPage',
      // The page limit is checked before the unique slug, so either refusal is the domain's.
      conflict: 'a page with the reviewed slug created out of band',
      preempt: (_f, s) => db.statusPage.create({ data: { name: 'Out of band', slug: s.slug } }),
      applied: async (_f, s) => {
        const pages = await db.statusPage.findMany({
          where: { slug: s.slug },
          select: { id: true },
        });
        return {
          effects: await db.statusPage.count({ where: { slug: s.slug, name: s.name } }),
          audits: await db.auditLog.count({
            where: { action: 'status_page.created', entityId: { in: pages.map(p => p.id) } },
          }),
        };
      },
    },
    {
      operationId: 'retryNotification',
      conflict: 'the notification delivered out of band',
      preempt: (_f, s) =>
        db.notification.update({
          where: { id: s.id },
          data: { status: 'SENT', sentAt: new Date(), failedAt: null, errorMsg: null },
        }),
      applied: async (_f, s) => ({
        effects:
          (await db.notification.findUniqueOrThrow({ where: { id: s.id } })).status === 'PENDING'
            ? 1
            : 0,
        audits: await db.auditLog.count({
          where: { action: 'notification.retry_requested', entityId: s.id },
        }),
      }),
    },
  ];
  const scenarioFor = (operationId: string) =>
    scenarios.find(scenario => scenario.operationId === operationId)!;

  it.each(natural)(
    'refuses $operationId definitively after $conflict, on commit and on retry',
    async ({ operationId, preempt, applied }) => {
      const scenario = scenarioFor(operationId);
      const f = await fixture();
      const s = await scenario.setup(f);
      const approval = await approve(f, scenario, s);
      await preempt(f, s);
      const before = JSON.stringify(await scenario.effect(f, s));
      const effectsBefore = await applied(f, s);
      await expect(
        commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
      ).rejects.toThrow('MCP_DOMAIN_REJECTED');
      expect(await approvalStatus(approval.approvalId)).toBe('FAILED');
      await expect(
        commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
      ).resolves.toMatchObject({ status: 'FAILED', replayed: true });
      expect(JSON.stringify(await scenario.effect(f, s))).toBe(before);
      expect(await applied(f, s)).toEqual(effectsBefore);
      expect(await approvalStatus(approval.approvalId)).toBe('FAILED');
      expect(await committedAudits(approval.approvalId)).toBe(0);
    }
  );

  it.each(natural)(
    'applies $operationId once under eight concurrent commits of one approval',
    async ({ operationId, applied }) => {
      const scenario = scenarioFor(operationId);
      const f = await fixture();
      const s = await scenario.setup(f);
      const approval = await approve(f, scenario, s);
      const settled = await Promise.allSettled(
        Array.from({ length: 8 }, () =>
          commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
        )
      );
      const committed = settled.filter(result => result.status === 'fulfilled');
      expect(committed.length).toBeGreaterThan(0);
      for (const result of committed) expect(result.value).toMatchObject({ status: 'COMMITTED' });
      expect(await applied(f, s)).toEqual({ effects: 1, audits: 1 });
      expect(await approvalStatus(approval.approvalId)).toBe('COMMITTED');
      expect(await committedAudits(approval.approvalId)).toBe(1);
      await expect(
        commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
      ).resolves.toMatchObject({ status: 'COMMITTED', replayed: true });
      expect(await applied(f, s)).toEqual({ effects: 1, audits: 1 });
    }
  );
});

describe('conflict retryability', () => {
  const create = scenarios.find(scenario => scenario.operationId === 'createStatusPage')!;
  const pagesCreated = async (s: Record<string, string>) => {
    const pages = await db.statusPage.findMany({
      where: { slug: s.slug, name: s.name },
      select: { id: true },
    });
    return {
      pages: pages.length,
      audits: await db.auditLog.count({
        where: { action: 'status_page.created', entityId: { in: pages.map(page => page.id) } },
      }),
    };
  };
  const problem = (code: string, retryable: boolean) =>
    JSON.stringify({ type: 'about:blank', title: 'Conflict', status: 409, code, retryable });

  /** Answers the approved command with a 409 instead of running the real route. */
  async function withConflict<T>(body: string, contentType: string, run: () => Promise<T>) {
    const original = MCP_APPROVAL_HANDLERS.get(create.operationId)!;
    MCP_APPROVAL_HANDLERS.set(
      create.operationId,
      async () => async () =>
        new Response(body, { status: 409, headers: { 'content-type': contentType } })
    );
    try {
      return await run();
    } finally {
      MCP_APPROVAL_HANDLERS.set(create.operationId, original);
    }
  }

  it.each([
    {
      kind: 'retryable problem',
      body: problem('TRANSIENT_CONFLICT', true),
      contentType: 'application/problem+json',
    },
    { kind: 'non-JSON body', body: 'conflict, try again later', contentType: 'text/plain' },
  ])(
    'keeps the approval retryable after a 409 with a $kind, then commits once',
    async ({ body, contentType }) => {
      const f = await fixture();
      const s = await create.setup(f);
      const approval = await approve(f, create, s);
      await withConflict(body, contentType, () =>
        expect(
          commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
        ).rejects.toMatchObject({ code: 'MCP_DOMAIN_REJECTED', status: 409, retryable: true })
      );
      expect(await approvalStatus(approval.approvalId)).toBe('EXECUTING');
      expect(await pagesCreated(s)).toEqual({ pages: 0, audits: 0 });
      expect(await committedAudits(approval.approvalId)).toBe(0);

      await expect(
        commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
      ).resolves.toMatchObject({ status: 'COMMITTED' });
      await expect(
        commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
      ).resolves.toMatchObject({ status: 'COMMITTED', replayed: true });
      expect(await approvalStatus(approval.approvalId)).toBe('COMMITTED');
      expect(await pagesCreated(s)).toEqual({ pages: 1, audits: 1 });
      expect(await committedAudits(approval.approvalId)).toBe(1);
    }
  );

  it('ends the approval on a 409 marked not retryable, and never applies it later', async () => {
    const f = await fixture();
    const s = await create.setup(f);
    const approval = await approve(f, create, s);
    await withConflict(problem('RESOURCE_CONFLICT', false), 'application/problem+json', () =>
      expect(
        commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
      ).rejects.toMatchObject({ code: 'MCP_DOMAIN_REJECTED', status: 409, retryable: false })
    );
    expect(await approvalStatus(approval.approvalId)).toBe('FAILED');

    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
    ).resolves.toMatchObject({ status: 'FAILED', replayed: true });
    expect(await approvalStatus(approval.approvalId)).toBe('FAILED');
    expect(await pagesCreated(s)).toEqual({ pages: 0, audits: 0 });
    expect(await committedAudits(approval.approvalId)).toBe(0);
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
