import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';
import { fixture, type Fixture } from '../helpers/mcp-approval';
import { CostBudget } from '@/lib/mcp/core/budget';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import type { ExecutionContext } from '@/lib/mcp/core/execution';
import { commitApprovedMcpOperation, prepareMcpOperation } from '@/lib/mcp/approvals/operation';

class FailingBudget extends CostBudget {
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
const withBudget = (f: Fixture, budget: CostBudget): ExecutionContext => ({ ...f.ctx(), budget });

beforeAll(async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
    throw new Error('Owned local test database required');
  process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
  process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
  process.env.MCP_TOKEN_HASH_SECRET = randomBytes(32).toString('hex');
  process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  await resetDatabase();
}, 60000);
beforeEach(async () => {
  await db.mcpPolicy.upsert({
    where: { id: 'default' },
    create: { enabled: true, writesEnabled: true, requestsPerMinute: 6000 },
    update: { enabled: true, writesEnabled: true, requestsPerMinute: 6000 },
  });
});

const key = () => `prepare-${randomBytes(8).toString('hex')}`;
const classification = {
  derivePriorityFromUrgency: false,
  priorityFallbackMode: 'INHERIT',
  rules: [
    {
      matchValue: 'critical',
      priorityMode: 'SET',
      priority: 'P1',
      urgencyMode: 'SET',
      urgency: 'HIGH',
    },
    {
      matchValue: 'error',
      priorityMode: 'SET',
      priority: 'P2',
      urgencyMode: 'SET',
      urgency: 'HIGH',
    },
    {
      matchValue: 'warning',
      priorityMode: 'SET',
      priority: 'P3',
      urgencyMode: 'SET',
      urgency: 'MEDIUM',
    },
    { matchValue: 'info', priorityMode: 'SET', priority: 'P4', urgencyMode: 'SET', urgency: 'LOW' },
  ],
};
const sla = {
  inheritWorkspace: false,
  baseAckTargetMs: 300000,
  baseResolveTargetMs: 3600000,
  rules: [{ priority: 'P1', ackTargetMs: 60000, resolveTargetMs: 600000 }],
};

interface Scenario {
  name: string;
  operationId: string;
  setup(f: Fixture): Promise<Record<string, string>>;
  input(f: Fixture, s: Record<string, string>): Promise<{ args: Record<string, unknown> }>;
  /** Stable description of the committed effect, comparable across runs. */
  effect(f: Fixture, s: Record<string, string>): Promise<unknown>;
  /** Changes the target out of band so the frozen revision is stale. */
  invalidate(f: Fixture, s: Record<string, string>): Promise<void>;
}
const scenarios: Scenario[] = [
  {
    name: 'team membership',
    operationId: 'setTeamMember',
    setup: async f => ({ userId: (await createTestUser({ role: 'USER' })).id, teamId: f.team.id }),
    input: async (f, s) => ({
      args: {
        path: { id: s.teamId, userId: s.userId },
        body: { role: 'ADMIN', receiveTeamNotifications: false },
        ifMatch: `"${await f.teamRevision()}"`,
      },
    }),
    effect: async (_f, s) => {
      const rows = await db.teamMember.findMany({ where: { teamId: s.teamId, userId: s.userId } });
      return rows.map(row => [row.role, row.receiveTeamNotifications]);
    },
    invalidate: async (_f, s) => {
      await db.team.update({ where: { id: s.teamId }, data: { description: 'moved on' } });
    },
  },
  {
    name: 'team service assignment',
    operationId: 'assignTeamService',
    setup: async f => ({ serviceId: (await createTestService('Assigned')).id, teamId: f.team.id }),
    input: async (_f, s) => ({
      args: {
        path: { id: s.teamId, serviceId: s.serviceId },
        body: {},
        ifMatch: `"${(await db.service.findUniqueOrThrow({ where: { id: s.serviceId } })).revision}"`,
      },
    }),
    effect: async (_f, s) =>
      (await db.service.findUniqueOrThrow({ where: { id: s.serviceId } })).teamId === s.teamId,
    invalidate: async (_f, s) => {
      await db.service.update({ where: { id: s.serviceId }, data: { description: 'moved on' } });
    },
  },
  {
    name: 'SLA policy',
    operationId: 'updateServiceSlaPolicy',
    setup: async () => ({ serviceId: (await createTestService('Sla')).id }),
    input: async (_f, s) => ({
      args: { path: { id: s.serviceId }, body: sla, ifMatch: '"0"' },
    }),
    effect: async (_f, s) =>
      (await db.incidentSlaPolicy.findMany({ where: { scopeKey: `service:${s.serviceId}` } })).map(
        policy => [policy.version, policy.baseAckTargetMs]
      ),
    invalidate: async (_f, s) => {
      await db.incidentSlaPolicy.create({
        data: {
          scopeKey: `service:${s.serviceId}`,
          version: 1,
          inheritWorkspace: true,
          sealedAt: new Date(),
        },
      });
    },
  },
  {
    name: 'classification policy',
    operationId: 'updateServiceClassificationPolicy',
    setup: async () => ({ serviceId: (await createTestService('Classify')).id }),
    input: async (_f, s) => ({
      args: { path: { id: s.serviceId }, body: classification, ifMatch: '"0"' },
    }),
    effect: async (_f, s) =>
      (
        await db.incidentClassificationPolicy.findMany({
          where: { scopeKey: `service:${s.serviceId}` },
        })
      ).map(policy => [policy.version, policy.priorityFallbackMode]),
    invalidate: async (_f, s) => {
      await db.incidentClassificationPolicy.create({
        data: {
          scopeKey: `service:${s.serviceId}`,
          version: 1,
          inheritWorkspace: false,
          derivePriorityFromUrgency: false,
          priorityFallbackMode: 'DISABLED',
          sealedAt: new Date(),
        },
      });
    },
  },
];

async function prepared(f: Fixture, scenario: Scenario, s: Record<string, string>) {
  const { args } = await scenario.input(f, s);
  const approval = await prepareMcpOperation(f.ctx(), {
    operationId: scenario.operationId,
    args,
    idempotencyKey: key(),
  });
  await f.review(approval);
  return approval;
}

describe.each(scenarios)('approval-gated $name ($operationId)', scenario => {
  it('commits once through the existing command and records an audit trail', async () => {
    const f = await fixture();
    const s = await scenario.setup(f);
    const before = JSON.stringify(await scenario.effect(f, s));
    const approval = await prepared(f, scenario, s);
    expect(JSON.stringify(await scenario.effect(f, s))).toBe(before);
    const committed = await commitApprovedMcpOperation(f.ctx(), {
      approvalId: approval.approvalId,
    });
    expect(committed).toMatchObject({ status: 'COMMITTED' });
    const after = JSON.stringify(await scenario.effect(f, s));
    expect(after).not.toBe(before);
    await commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId });
    expect(JSON.stringify(await scenario.effect(f, s))).toBe(after);
    expect(
      (
        await db.auditLog.findMany({
          where: { entityId: approval.approvalId },
          select: { action: true },
        })
      )
        .map(entry => entry.action)
        .sort()
    ).toEqual(['mcp.operation.approved', 'mcp.operation.committed', 'mcp.operation.prepared']);
  });

  it('rejects a stale frozen revision without any effect and ends the approval', async () => {
    const f = await fixture();
    const s = await scenario.setup(f);
    const approval = await prepared(f, scenario, s);
    await scenario.invalidate(f, s);
    const before = JSON.stringify(await scenario.effect(f, s));
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
    ).rejects.toThrow('MCP_DOMAIN_REJECTED');
    expect(JSON.stringify(await scenario.effect(f, s))).toBe(before);
    expect(
      (await db.mcpOperationApproval.findUniqueOrThrow({ where: { id: approval.approvalId } }))
        .status
    ).toBe('FAILED');
  });

  it('refuses an unauthorized reviewer and a revoked requester', async () => {
    const f = await fixture();
    const s = await scenario.setup(f);
    const { args } = await scenario.input(f, s);
    const approval = await prepareMcpOperation(f.ctx(), {
      operationId: scenario.operationId,
      args,
      idempotencyKey: key(),
    });
    const ordinary = await createTestUser({ role: 'USER' });
    await expect(f.review(approval, 'approve', ordinary)).rejects.toThrow(
      'MCP_REVIEWER_NOT_AUTHORIZED'
    );
    await f.review(approval);
    const before = JSON.stringify(await scenario.effect(f, s));
    await db.mcpGrant.update({ where: { id: f.grant.id }, data: { revokedAt: new Date() } });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
    ).rejects.toThrow('MCP_INVALID_GRANT');
    expect(JSON.stringify(await scenario.effect(f, s))).toBe(before);
  });

  it('applies exactly one effect however the commit is interrupted', async () => {
    const baseline = await fixture();
    const baseState = await scenario.setup(baseline);
    const baseApproval = await prepared(baseline, scenario, baseState);
    const counter = new FailingBudget(0);
    await commitApprovedMcpOperation(withBudget(baseline, counter), {
      approvalId: baseApproval.approvalId,
    });
    let afterEffect = 0;
    for (let failAt = 1; failAt <= counter.consultations + 1; failAt++) {
      const f = await fixture();
      const s = await scenario.setup(f);
      const before = JSON.stringify(await scenario.effect(f, s));
      const approval = await prepared(f, scenario, s);
      try {
        await commitApprovedMcpOperation(withBudget(f, new FailingBudget(failAt)), {
          approvalId: approval.approvalId,
        });
      } catch {
        // injected crash / lost response
      }
      if (JSON.stringify(await scenario.effect(f, s)) !== before) afterEffect++;
      let settled: unknown;
      for (let attempt = 0; attempt < 4 && !settled; attempt++)
        settled = await commitApprovedMcpOperation(f.ctx(), {
          approvalId: approval.approvalId,
        }).catch(() => undefined);
      expect(settled, `failAt=${failAt}`).toMatchObject({ status: 'COMMITTED' });
      const after = JSON.stringify(await scenario.effect(f, s));
      await commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId });
      expect(JSON.stringify(await scenario.effect(f, s)), `failAt=${failAt}`).toBe(after);
      expect(after).not.toBe(before);
    }
    expect(afterEffect).toBeGreaterThan(0);
  });
});

describe('batch-wide', () => {
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
