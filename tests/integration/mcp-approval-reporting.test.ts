import { describe, expect, it } from 'vitest';
import { testPrisma as db } from '../helpers/test-db';
import { fixture, type Fixture } from '../helpers/mcp-approval';
import {
  describeApprovalScenarios,
  prepareKey,
  setupMcpApprovalDatabase,
  type Scenario,
} from '../helpers/mcp-approval-scenarios';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import { commitApprovedMcpOperation, prepareMcpOperation } from '@/lib/mcp/approvals/operation';

setupMcpApprovalDatabase();

const widget = (widgetType: string, metricKey: string) => ({
  widgetType,
  metricKey,
  position: { x: 0, y: 0, w: 1, h: 1 },
  config: {},
});

async function ownedDashboard(f: Fixture, name = 'Operations') {
  const dashboard = await db.dashboard.create({
    data: {
      name,
      userId: f.user.id,
      layout: { columns: 4, rowHeight: 120 },
      config: { timeRange: 7, refreshInterval: 60 },
      widgets: { create: widget('metric', 'totalIncidents') },
    },
  });
  return { dashboardId: dashboard.id };
}
const dashboardRow = (s: Record<string, string>) =>
  db.dashboard.findUniqueOrThrow({
    where: { id: s.dashboardId },
    include: { widgets: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
  });
const dashboardEtag = async (s: Record<string, string>) => `"${(await dashboardRow(s)).revision}"`;
const touchDashboard = async (_f: Fixture, s: Record<string, string>) => {
  await db.dashboard.update({ where: { id: s.dashboardId }, data: { description: 'moved on' } });
};
const ownedDashboards = async (f: Fixture) =>
  (
    await db.dashboard.findMany({
      where: { userId: f.user.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { widgets: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    })
  ).map(row => [row.name, row.visibility, row.widgets.map(item => item.widgetType)]);

async function savedReport(f: Fixture) {
  const report = await db.savedReport.create({
    data: { name: 'Weekly SLA', metricKeys: ['mtta', 'mttr'], windowDays: 7, userId: f.user.id },
  });
  return { reportId: report.id };
}
const reportRow = (s: Record<string, string>) =>
  db.savedReport.findUniqueOrThrow({ where: { id: s.reportId } });
const ownedReports = async (f: Fixture) =>
  (
    await db.savedReport.findMany({
      where: { userId: f.user.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  ).map(row => [row.name, row.metricKeys, row.windowDays, row.visibility]);

const scenarios: Scenario[] = [
  {
    name: 'dashboard update',
    operationId: 'updateReportDashboard',
    setup: f => ownedDashboard(f),
    input: async (_f, s) => ({
      args: {
        path: { id: s.dashboardId },
        body: { name: 'Reviewed operations', config: { timeRange: 30, refreshInterval: 300 } },
        ifMatch: await dashboardEtag(s),
      },
    }),
    effect: async (_f, s) => {
      const row = await dashboardRow(s);
      return [row.name, row.config, row.revision];
    },
    invalidate: touchDashboard,
  },
  {
    name: 'dashboard create',
    operationId: 'createReportDashboard',
    setup: async () => ({}),
    input: async () => ({
      args: {
        body: {
          name: 'Reviewed dashboard',
          visibility: 'PRIVATE',
          widgets: [widget('gauge', 'ackCompliance')],
        },
      },
    }),
    effect: f => ownedDashboards(f),
  },
  {
    name: 'dashboard duplicate',
    operationId: 'duplicateReportDashboard',
    setup: f => ownedDashboard(f, 'Source'),
    input: async (_f, s) => ({
      args: { path: { id: s.dashboardId }, body: { name: 'Reviewed copy', visibility: 'PRIVATE' } },
    }),
    effect: f => ownedDashboards(f),
  },
  {
    name: 'dashboard widget replacement',
    operationId: 'replaceReportDashboardWidgets',
    setup: f => ownedDashboard(f),
    input: async (_f, s) => ({
      args: {
        path: { id: s.dashboardId },
        body: { widgets: [widget('gauge', 'ackCompliance'), widget('metric', 'activeIncidents')] },
        ifMatch: await dashboardEtag(s),
      },
    }),
    effect: async (_f, s) => {
      const row = await dashboardRow(s);
      return [row.revision, row.widgets.map(item => [item.widgetType, item.metricKey])];
    },
    invalidate: touchDashboard,
  },
  {
    name: 'saved report update',
    operationId: 'updateSavedReport',
    setup: f => savedReport(f),
    input: async (_f, s) => ({
      args: {
        path: { id: s.reportId },
        body: { name: 'Reviewed SLA', windowDays: 30, metrics: ['mtta', 'mttr', 'ackRate'] },
        ifMatch: `"${(await reportRow(s)).revision}"`,
      },
    }),
    effect: async (_f, s) => {
      const row = await reportRow(s);
      return [row.name, row.windowDays, row.metricKeys, row.revision];
    },
    invalidate: async (_f, s) => {
      await db.savedReport.update({ where: { id: s.reportId }, data: { description: 'moved on' } });
    },
  },
  {
    name: 'saved report create',
    operationId: 'createSavedReport',
    setup: async () => ({}),
    input: async () => ({
      args: { body: { name: 'Reviewed report', metrics: ['mttr'], windowDays: 14 } },
    }),
    effect: f => ownedReports(f),
  },
];

describeApprovalScenarios(scenarios);

describe('reporting batch-wide', () => {
  it('keeps every operation out of generic dispatch', async () => {
    const f = await fixture();
    for (const scenario of scenarios)
      await expect(
        callMcpOperation(f.ctx(), scenario.operationId, {
          path: { id: 'cmcpgenericdispatch0000001' },
          body: {},
          idempotencyKey: 'generic-dispatch-attempt-1',
          ifMatch: '"1"',
        })
      ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
  });

  // Creates and duplicates have no revision to go stale. The reviewer approves one digest over
  // the exact frozen path and body; a changed body is a different plan that needs its own review,
  // and the commit applies exactly the reviewed body.
  it.each(scenarios.filter(scenario => !scenario.invalidate))(
    'binds $operationId to the reviewed body rather than a revision',
    async scenario => {
      const f = await fixture();
      const s = await scenario.setup(f);
      const { args } = await scenario.input(f, s);
      const reviewed = await prepareMcpOperation(f.ctx(), {
        operationId: scenario.operationId,
        args,
        idempotencyKey: prepareKey(),
      });
      const altered = await prepareMcpOperation(f.ctx(), {
        operationId: scenario.operationId,
        args: { ...args, body: { ...(args.body as object), name: 'Swapped' } },
        idempotencyKey: prepareKey(),
      });
      expect(altered.operationDigest).not.toBe(reviewed.operationDigest);
      await expect(
        f.review({ approvalId: altered.approvalId, operationDigest: reviewed.operationDigest })
      ).rejects.toThrow('MCP_APPROVAL_PLAN_CHANGED');
      await f.review(reviewed);
      const before = JSON.stringify(await scenario.effect(f, s));
      await expect(
        commitApprovedMcpOperation(f.ctx(), { approvalId: altered.approvalId })
      ).rejects.toThrow('MCP_APPROVAL_REQUIRED');
      expect(JSON.stringify(await scenario.effect(f, s))).toBe(before);
      await commitApprovedMcpOperation(f.ctx(), { approvalId: reviewed.approvalId });
      const after = JSON.stringify(await scenario.effect(f, s));
      expect(after).not.toBe(before);
      expect(after).toContain('Reviewed');
      expect(after).not.toContain('Swapped');
    }
  );
});
