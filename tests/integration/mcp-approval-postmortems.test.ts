import { describe, expect, it } from 'vitest';
import { createTestIncident, createTestService, testPrisma as db } from '../helpers/test-db';
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

// Postmortems may only exist (and be published) for resolved incidents.
async function resolvedIncident() {
  const service = await createTestService('Postmortem approval');
  const incident = await createTestIncident('Database failover', service.id, {
    status: 'RESOLVED',
    resolvedAt: new Date(),
  });
  return { incidentId: incident.id };
}
async function draftPostmortem(f: Fixture, withActionItem = false) {
  const { incidentId } = await resolvedIncident();
  const postmortem = await db.postmortem.create({
    data: {
      incidentId,
      title: 'Database failover',
      summary: 'Primary database failed over during peak load.',
      status: 'DRAFT',
      isPublic: true,
      createdById: f.user.id,
    },
  });
  const s: Record<string, string> = { incidentId, postmortemId: postmortem.id };
  if (withActionItem) {
    const item = await db.actionItem.create({
      data: { postmortemId: postmortem.id, incidentId, title: 'Add replica lag alert' },
    });
    s.itemId = item.id;
  }
  return s;
}
const postmortemRow = (s: Record<string, string>) =>
  db.postmortem.findUniqueOrThrow({ where: { id: s.postmortemId } });
const postmortemEtag = async (s: Record<string, string>) =>
  `"${(await postmortemRow(s)).revision}"`;
const touchPostmortem = async (_f: Fixture, s: Record<string, string>) => {
  await db.postmortem.update({ where: { id: s.postmortemId }, data: { lessons: 'moved on' } });
};
const actionItems = async (s: Record<string, string>) => [
  (await postmortemRow(s)).revision,
  (
    await db.actionItem.findMany({
      where: { postmortemId: s.postmortemId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
  ).map(item => [item.title, item.status, item.priority, item.completedAt !== null]),
];

const scenarios: Scenario[] = [
  {
    name: 'postmortem update',
    operationId: 'updatePostmortem',
    setup: f => draftPostmortem(f),
    input: async (_f, s) => ({
      args: {
        path: { id: s.postmortemId },
        body: { title: 'Reviewed failover analysis', rootCause: 'Replica lag exceeded the SLO.' },
        ifMatch: await postmortemEtag(s),
      },
    }),
    effect: async (_f, s) => {
      const row = await postmortemRow(s);
      return [row.title, row.rootCause, row.revision];
    },
    invalidate: touchPostmortem,
  },
  {
    name: 'postmortem action item update',
    operationId: 'updatePostmortemActionItem',
    setup: f => draftPostmortem(f, true),
    input: async (_f, s) => ({
      args: {
        path: { id: s.postmortemId, itemId: s.itemId },
        body: { status: 'COMPLETED', priority: 'HIGH' },
        ifMatch: await postmortemEtag(s),
      },
    }),
    effect: async (_f, s) => actionItems(s),
    invalidate: touchPostmortem,
  },
  {
    name: 'postmortem create',
    operationId: 'createPostmortem',
    setup: () => resolvedIncident(),
    input: async (_f, s) => ({
      args: {
        body: {
          incidentId: s.incidentId,
          title: 'Reviewed postmortem',
          summary: 'Primary database failed over during peak load.',
        },
      },
    }),
    effect: async (_f, s) =>
      (await db.postmortem.findMany({ where: { incidentId: s.incidentId } })).map(row => [
        row.title,
        row.summary,
        row.status,
      ]),
  },
  {
    name: 'postmortem publication',
    operationId: 'publishPostmortem',
    setup: f => draftPostmortem(f),
    input: async (_f, s) => ({
      args: {
        path: { id: s.postmortemId },
        body: { isPublic: false },
        ifMatch: await postmortemEtag(s),
      },
    }),
    effect: async (_f, s) => {
      const row = await postmortemRow(s);
      return [row.status, row.isPublic, row.publishedAt !== null, row.revision];
    },
    invalidate: touchPostmortem,
  },
  {
    name: 'postmortem action item replacement',
    operationId: 'replacePostmortemActionItems',
    setup: f => draftPostmortem(f, true),
    input: async (_f, s) => ({
      args: {
        path: { id: s.postmortemId },
        body: {
          items: [
            { id: s.itemId, title: 'Add replica lag alert', status: 'IN_PROGRESS' },
            { title: 'Rehearse failover quarterly', priority: 'HIGH', dueDate: '2026-12-01' },
          ],
        },
        ifMatch: await postmortemEtag(s),
      },
    }),
    effect: async (_f, s) => actionItems(s),
    invalidate: touchPostmortem,
  },
  {
    name: 'postmortem contributors',
    operationId: 'replacePostmortemContributors',
    setup: f => draftPostmortem(f),
    input: async (f, s) => ({
      args: {
        path: { id: s.postmortemId },
        body: {
          contributors: [
            { userId: f.user.id, role: 'AUTHOR' },
            { userId: f.lead.id, role: 'REVIEWER' },
          ],
        },
        ifMatch: await postmortemEtag(s),
      },
    }),
    effect: async (_f, s) => [
      (await postmortemRow(s)).revision,
      (
        await db.postmortemContributor.findMany({
          where: { postmortemId: s.postmortemId },
          orderBy: { userId: 'asc' },
        })
      ).map(entry => [entry.userId, entry.role]),
    ],
    invalidate: touchPostmortem,
  },
];

describeApprovalScenarios(scenarios);

describe('postmortem batch-wide', () => {
  it('keeps every operation out of generic dispatch', async () => {
    const f = await fixture();
    for (const scenario of scenarios)
      await expect(
        callMcpOperation(f.ctx(), scenario.operationId, {
          path: { id: 'cmcpgenericdispatch0000001', itemId: 'cmcpgenericdispatch0000002' },
          body: {},
          idempotencyKey: 'generic-dispatch-attempt-1',
          ifMatch: '"1"',
        })
      ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
  });

  // Creation has no revision: the digest binds the exact reviewed body, and the incident's
  // single-postmortem invariant refuses the commit if one appeared after review.
  it('binds a frozen create to the reviewed body and the incident it documents', async () => {
    const create = scenarios.find(scenario => scenario.operationId === 'createPostmortem')!;
    const f = await fixture();
    const s = await create.setup(f);
    const { args } = await create.input(f, s);
    const reviewed = await prepareMcpOperation(f.ctx(), {
      operationId: 'createPostmortem',
      args,
      idempotencyKey: prepareKey(),
    });
    const altered = await prepareMcpOperation(f.ctx(), {
      operationId: 'createPostmortem',
      args: { body: { ...(args.body as object), title: 'Swapped postmortem' } },
      idempotencyKey: prepareKey(),
    });
    expect(altered.operationDigest).not.toBe(reviewed.operationDigest);
    await expect(
      f.review({ approvalId: altered.approvalId, operationDigest: reviewed.operationDigest })
    ).rejects.toThrow('MCP_APPROVAL_PLAN_CHANGED');
    await f.review(reviewed);
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: altered.approvalId })
    ).rejects.toThrow('MCP_APPROVAL_REQUIRED');
    expect(await create.effect(f, s)).toEqual([]);
    await commitApprovedMcpOperation(f.ctx(), { approvalId: reviewed.approvalId });
    expect(await create.effect(f, s)).toEqual([
      ['Reviewed postmortem', 'Primary database failed over during peak load.', 'DRAFT'],
    ]);

    const raced = await create.setup(f);
    const late = await prepareMcpOperation(f.ctx(), {
      operationId: 'createPostmortem',
      args: (await create.input(f, raced)).args,
      idempotencyKey: prepareKey(),
    });
    await f.review(late);
    await db.postmortem.create({
      data: { incidentId: raced.incidentId, title: 'Written by hand', createdById: f.reviewer.id },
    });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: late.approvalId })
    ).rejects.toThrow('MCP_DOMAIN_REJECTED');
    expect(await create.effect(f, raced)).toEqual([['Written by hand', null, 'DRAFT']]);
  });

  // The PATCH route accepts an unconditional update; the reviewer is shown that it is unbound.
  it('shows the reviewer when a postmortem update carries no If-Match', async () => {
    const f = await fixture();
    const s = await draftPostmortem(f);
    const prepared = await prepareMcpOperation(f.ctx(), {
      operationId: 'updatePostmortem',
      args: { path: { id: s.postmortemId }, body: { lessons: 'Alert on replica lag.' } },
      idempotencyKey: prepareKey(),
    });
    expect(prepared.summary).toMatchObject({
      ifMatch: null,
      targets: { id: s.postmortemId },
      changes: [['lessons', 'Alert on replica lag.']],
    });
    await f.review(prepared);
    await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId });
    expect((await postmortemRow(s)).lessons).toBe('Alert on replica lag.');
  });
});
