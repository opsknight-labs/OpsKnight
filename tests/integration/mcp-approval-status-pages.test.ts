import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestService, linkServiceToStatusPage, testPrisma as db } from '../helpers/test-db';
import { fixture } from '../helpers/mcp-approval';
import {
  describeApprovalScenarios,
  prepareKey,
  setupMcpApprovalDatabase,
  type Scenario,
} from '../helpers/mcp-approval-scenarios';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import { commitApprovedMcpOperation, prepareMcpOperation } from '@/lib/mcp/approvals/operation';
import { getStatusPageServingStore } from '@/lib/status-pages/serving-store';
import { publishStatusPageSnapshot } from '@/lib/status-pages/snapshot';

setupMcpApprovalDatabase();

const RETRY_TASK = 'STATUS_PAGE_PUBLICATION_RETRY';

/** A live page with a published public projection, so every scenario starts from what the public sees. */
async function publishedPage(linkedServices = 0) {
  const unique = randomUUID();
  const page = await db.statusPage.create({
    data: {
      name: `Approval status page ${unique}`,
      slug: `approval-${unique}`,
      enabled: true,
      organizationName: 'Original organization',
      footerText: 'Original footer',
    },
  });
  const services: string[] = [];
  for (let index = 0; index < linkedServices; index++) {
    const service = await createTestService(`Status approval ${index}`);
    await linkServiceToStatusPage(page.id, service.id, { order: index });
    services.push(service.id);
  }
  await publishStatusPageSnapshot(page.id);
  return { pageId: page.id, services };
}
const page = (s: Record<string, string>) =>
  db.statusPage.findUniqueOrThrow({ where: { id: s.pageId } });
const ifMatch = async (s: Record<string, string>) => `"${(await page(s)).revision}"`;
// The revision trigger bumps on any StatusPage update, so a touch is an out-of-band edit.
const touch = async (_f: unknown, s: Record<string, string>) => {
  await db.statusPage.update({ where: { id: s.pageId }, data: { updatedAt: new Date() } });
};
const mappings = async (s: Record<string, string>) =>
  (
    await db.statusPageService.findMany({
      where: { statusPageId: s.pageId },
      select: { serviceId: true, displayName: true, order: true, showOnPage: true },
    })
  ).sort((a, b) => a.serviceId.localeCompare(b.serviceId));

/** Everything an anonymous visitor can be served, plus the serving decision that gates it. */
async function publicProjection(pageId: string) {
  const control = await db.statusPageSnapshot.findUniqueOrThrow({
    where: { statusPageId: pageId },
    select: { revision: true, publishedRevision: true, servingState: true, lastError: true },
  });
  return {
    control,
    served: await getStatusPageServingStore().readLastGoodSnapshot(pageId),
  };
}

const scenarios: Scenario[] = [
  {
    name: 'appearance',
    operationId: 'updateStatusPageAppearance',
    setup: async () => ({ pageId: (await publishedPage()).pageId }),
    input: async (_f, s) => ({
      args: {
        path: { id: s.pageId },
        body: { branding: { primaryColor: '#123456' } },
        ifMatch: await ifMatch(s),
      },
    }),
    effect: async (_f, s) => {
      const row = await page(s);
      return [row.branding, row.revision];
    },
    invalidate: touch,
  },
  {
    name: 'content',
    operationId: 'updateStatusPageContent',
    setup: async () => ({ pageId: (await publishedPage()).pageId }),
    input: async (_f, s) => ({
      args: {
        path: { id: s.pageId },
        body: { footerText: 'Approved footer' },
        ifMatch: await ifMatch(s),
      },
    }),
    effect: async (_f, s) => {
      const row = await page(s);
      return [row.footerText, row.revision];
    },
    invalidate: touch,
  },
  {
    name: 'single service presentation',
    operationId: 'updateStatusPageService',
    setup: async () => {
      const created = await publishedPage(2);
      return { pageId: created.pageId, serviceId: created.services[0] };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.pageId, serviceId: s.serviceId },
        body: { displayName: 'Approved display name', showOnPage: false },
        ifMatch: await ifMatch(s),
      },
    }),
    effect: async (_f, s) => [await mappings(s), (await page(s)).revision],
    invalidate: touch,
  },
  {
    name: 'general settings',
    operationId: 'updateStatusPageSettings',
    setup: async () => ({ pageId: (await publishedPage()).pageId }),
    input: async (_f, s) => ({
      args: {
        path: { id: s.pageId },
        body: { organizationName: 'Approved organization' },
        ifMatch: await ifMatch(s),
      },
    }),
    effect: async (_f, s) => {
      const row = await page(s);
      return [row.organizationName, row.revision];
    },
    invalidate: touch,
  },
  {
    name: 'publication retry',
    operationId: 'retryStatusPagePublication',
    setup: async () => {
      // Admission is globally bounded; earlier fixtures' never-claimed jobs are not this page's work.
      await db.backgroundJob.updateMany({
        where: {
          type: 'SCHEDULED_TASK',
          status: { in: ['PENDING', 'PROCESSING'] },
          payload: { path: ['task'], equals: RETRY_TASK },
        },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      return { pageId: (await publishedPage()).pageId };
    },
    input: async (_f, s) => ({
      args: { path: { id: s.pageId }, body: {}, ifMatch: await ifMatch(s) },
    }),
    effect: async (_f, s) =>
      (
        await db.backgroundJob.findMany({
          where: {
            AND: [
              { payload: { path: ['task'], equals: RETRY_TASK } },
              { payload: { path: ['pageId'], equals: s.pageId } },
            ],
          },
          select: { status: true },
        })
      ).map(job => job.status),
    invalidate: touch,
  },
  {
    name: 'service set',
    operationId: 'setStatusPageServices',
    setup: async () => {
      const created = await publishedPage(2);
      const added = await createTestService('Status approval added');
      return { pageId: created.pageId, keptId: created.services[0], addedId: added.id };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.pageId },
        body: {
          serviceIds: [s.keptId, s.addedId],
          serviceConfigs: { [s.addedId]: { displayName: 'Approved addition', order: 1 } },
        },
        ifMatch: await ifMatch(s),
      },
    }),
    effect: async (_f, s) => [await mappings(s), (await page(s)).revision],
    invalidate: touch,
  },
];

describeApprovalScenarios(scenarios);

describe('status page batch-wide', () => {
  it('keeps every operation out of generic dispatch', async () => {
    const f = await fixture();
    for (const scenario of scenarios)
      await expect(
        callMcpOperation(f.ctx(), scenario.operationId, {
          path: { id: 'cmcpgenericdispatch0000001', serviceId: 'cmcpgenericdispatch0000002' },
          body: {},
          idempotencyKey: 'generic-dispatch-attempt-1',
          ifMatch: '"1"',
        })
      ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
  });

  it.each(scenarios)(
    'a rejected $operationId leaves the configuration and public projection unchanged',
    async scenario => {
      const f = await fixture();
      const s = await scenario.setup(f);
      const { args } = await scenario.input(f, s);
      const publicBefore = await publicProjection(s.pageId);
      expect(publicBefore.served).not.toBeNull();
      const effectBefore = JSON.stringify(await scenario.effect(f, s));
      const approval = await prepareMcpOperation(f.ctx(), {
        operationId: scenario.operationId,
        args,
        idempotencyKey: prepareKey(),
      });
      await f.review(approval, 'reject');
      await expect(
        commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
      ).rejects.toThrow('MCP_APPROVAL_REJECTED');
      expect(
        (await db.mcpOperationApproval.findUniqueOrThrow({ where: { id: approval.approvalId } }))
          .status
      ).toBe('REJECTED');
      expect(JSON.stringify(await scenario.effect(f, s))).toBe(effectBefore);
      expect(await publicProjection(s.pageId)).toEqual(publicBefore);
      expect(
        await db.auditLog.count({
          where: {
            entityId: s.pageId,
            action: {
              in: ['status_page.config.updated', 'status_page.publication.retry_requested'],
            },
          },
        })
      ).toBe(0);
    }
  );

  it('publishes an approved content change to the public projection', async () => {
    const f = await fixture();
    const content = scenarios.find(scenario => scenario.operationId === 'updateStatusPageContent')!;
    const s = await content.setup(f);
    const { args } = await content.input(f, s);
    const approval = await prepareMcpOperation(f.ctx(), {
      operationId: content.operationId,
      args,
      idempotencyKey: prepareKey(),
    });
    expect(JSON.stringify((await publicProjection(s.pageId)).served)).toContain('Original footer');
    await f.review(approval);
    await commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId });
    const served = JSON.stringify((await publicProjection(s.pageId)).served);
    expect(served).toContain('Approved footer');
    expect(served).not.toContain('Original footer');
  });
});
