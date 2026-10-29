import { randomBytes } from 'node:crypto';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestUser, resetDatabase, testPrisma as db } from './test-db';
import { fixture, type Fixture } from './mcp-approval';
import { CostBudget } from '@/lib/mcp/core/budget';
import { McpBoundaryError } from '@/lib/mcp/core/errors';
import type { ExecutionContext } from '@/lib/mcp/core/execution';
import { commitApprovedMcpOperation, prepareMcpOperation } from '@/lib/mcp/approvals/operation';

/** Isolated database and MCP policy for an approval-batch test file. */
export function setupMcpApprovalDatabase() {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? '');
    if (!url.pathname.endsWith('_test') || !['localhost', '127.0.0.1'].includes(url.hostname))
      throw new Error('Owned local test database required');
    process.env.MCP_PUBLIC_ORIGIN = 'http://localhost:3000';
    process.env.MCP_DATABASE_URL = process.env.DATABASE_URL;
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
}

export const prepareKey = () => `prepare-${randomBytes(8).toString('hex')}`;

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

export interface Scenario {
  name: string;
  operationId: string;
  setup(f: Fixture): Promise<Record<string, string>>;
  input(f: Fixture, s: Record<string, string>): Promise<{ args: Record<string, unknown> }>;
  /** Stable description of the committed effect, comparable across runs. */
  effect(f: Fixture, s: Record<string, string>): Promise<unknown>;
  /** Changes the target out of band so the frozen revision is stale. */
  invalidate?(f: Fixture, s: Record<string, string>): Promise<void>;
}

async function prepared(f: Fixture, scenario: Scenario, s: Record<string, string>) {
  const { args } = await scenario.input(f, s);
  const approval = await prepareMcpOperation(f.ctx(), {
    operationId: scenario.operationId,
    args,
    idempotencyKey: prepareKey(),
  });
  await f.review(approval);
  return approval;
}

/** The standard certification every approval-gated operation must pass before it is enabled. */
export function describeApprovalScenarios(scenarios: Scenario[]) {
  describe.each(scenarios)('approval-gated $name ($operationId)', (scenario: Scenario) => {
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

    // Operations without a revision precondition have no stale state to inject.
    (scenario.invalidate ? it : it.skip)(
      'rejects a stale frozen revision without any effect and ends the approval',
      async () => {
        const f = await fixture();
        const s = await scenario.setup(f);
        const approval = await prepared(f, scenario, s);
        await scenario.invalidate?.(f, s);
        const before = JSON.stringify(await scenario.effect(f, s));
        await expect(
          commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
          // Destructive operations detect the changed target from the preview before the domain does.
        ).rejects.toThrow(/MCP_DOMAIN_REJECTED|MCP_APPROVAL_PLAN_CHANGED/);
        expect(JSON.stringify(await scenario.effect(f, s))).toBe(before);
        expect(
          (await db.mcpOperationApproval.findUniqueOrThrow({ where: { id: approval.approvalId } }))
            .status
        ).toBe('FAILED');
      }
    );

    it('refuses an unauthorized reviewer and a revoked requester', async () => {
      const f = await fixture();
      const s = await scenario.setup(f);
      const { args } = await scenario.input(f, s);
      const approval = await prepareMcpOperation(f.ctx(), {
        operationId: scenario.operationId,
        args,
        idempotencyKey: prepareKey(),
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
}
