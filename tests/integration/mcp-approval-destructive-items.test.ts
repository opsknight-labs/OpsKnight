import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  createTestIncident,
  createTestOnCallSchedule,
  createTestService,
  createTestTeam,
  createTestUser,
  testPrisma as db,
} from '../helpers/test-db';
import { fixture } from '../helpers/mcp-approval';
import {
  describeApprovalScenarios,
  prepareKey,
  setupMcpApprovalDatabase,
  type Scenario,
} from '../helpers/mcp-approval-scenarios';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import {
  commitApprovedMcpOperation,
  loadMcpOperationReview,
  prepareMcpOperation,
} from '@/lib/mcp/approvals/operation';
import {
  actionItemInputSchema,
  replacePostmortemActionItems,
} from '@/lib/postmortems/action-item-commands';

setupMcpApprovalDatabase();

const etag = (revision: number) => `"${revision}"`;

// Every setup returns `target`: the identifier of the one item the operation removes.
const scenarios: Scenario[] = [
  {
    name: 'team member',
    operationId: 'removeTeamMember',
    setup: async () => {
      const team = await createTestTeam('Member removal approval');
      const member = await createTestUser();
      await db.teamMember.create({
        data: { teamId: team.id, userId: member.id, role: 'MEMBER' },
      });
      return { teamId: team.id, target: member.id };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.teamId, userId: s.target },
        ifMatch: etag((await db.team.findUniqueOrThrow({ where: { id: s.teamId } })).revision),
      },
    }),
    effect: async (_f, s) => db.teamMember.count({ where: { teamId: s.teamId, userId: s.target } }),
    // The route fences on the team revision.
    invalidate: async (_f, s) => {
      await db.team.update({
        where: { id: s.teamId },
        data: { description: 'Edited out of band', revision: { increment: 1 } },
      });
    },
  },
  {
    name: 'schedule participant',
    operationId: 'removeScheduleParticipant',
    setup: async () => {
      const first = await createTestUser();
      const second = await createTestUser();
      const schedule = await createTestOnCallSchedule('Participant removal approval', [
        { name: 'Primary', userIds: [first.id, second.id] },
      ]);
      return { scheduleId: schedule.id, layerId: schedule.layers[0].id, target: first.id };
    },
    // No If-Match on the route: the reviewed layer revision binds the commit.
    input: async (_f, s) => ({
      args: { path: { id: s.scheduleId, layerId: s.layerId, userId: s.target } },
    }),
    effect: async (_f, s) =>
      db.onCallLayerUser.count({ where: { layerId: s.layerId, userId: s.target } }),
    // Moving the participant changes the previewed position and, by trigger, the layer revision.
    invalidate: async (_f, s) => {
      await db.onCallLayerUser.update({
        where: { layerId_userId: { layerId: s.layerId, userId: s.target } },
        data: { position: 7 },
      });
    },
  },
  {
    name: 'schedule override',
    operationId: 'cancelScheduleOverride',
    setup: async () => {
      const covering = await createTestUser();
      const replaced = await createTestUser();
      const schedule = await createTestOnCallSchedule('Override cancel approval');
      const override = await db.onCallOverride.create({
        data: {
          scheduleId: schedule.id,
          userId: covering.id,
          replacesUserId: replaced.id,
          start: new Date('2026-11-01T00:00:00.000Z'),
          end: new Date('2026-11-01T08:00:00.000Z'),
        },
      });
      return { scheduleId: schedule.id, target: override.id };
    },
    input: async (_f, s) => ({
      args: { path: { id: s.scheduleId, overrideId: s.target } },
    }),
    effect: async (_f, s) => db.onCallOverride.count({ where: { id: s.target } }),
    // An override carries no revision: the commit re-reads the whole previewed projection.
    invalidate: async (_f, s) => {
      await db.onCallOverride.update({
        where: { id: s.target },
        data: { end: new Date('2026-11-01T12:00:00.000Z') },
      });
    },
  },
  {
    name: 'postmortem action item',
    operationId: 'deletePostmortemActionItem',
    setup: async f => {
      const service = await createTestService('Action item approval');
      const incident = await createTestIncident('Action item approval incident', service.id, {
        status: 'RESOLVED',
      });
      const postmortem = await db.postmortem.create({
        data: { incidentId: incident.id, title: 'Action item approval', createdById: f.user.id },
      });
      const collection = await db.$transaction(tx =>
        replacePostmortemActionItems(tx, postmortem.id, postmortem.revision, [
          actionItemInputSchema.parse({
            title: 'Add a regression test',
            description: 'Cover the failure mode',
            priority: 'HIGH',
          }),
          actionItemInputSchema.parse({ title: 'Document recovery', status: 'IN_PROGRESS' }),
        ])
      );
      return { postmortemId: postmortem.id, target: collection.items[0].id };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.postmortemId, itemId: s.target },
        ifMatch: etag(
          (await db.postmortem.findUniqueOrThrow({ where: { id: s.postmortemId } })).revision
        ),
      },
    }),
    effect: async (_f, s) => db.actionItem.count({ where: { id: s.target } }),
    // The route fences on the action-item collection (postmortem) revision.
    invalidate: async (_f, s) => {
      await db.postmortem.update({
        where: { id: s.postmortemId },
        data: { summary: 'Edited out of band', revision: { increment: 1 } },
      });
    },
  },
  {
    name: 'incident watcher',
    operationId: 'removeIncidentWatcher',
    setup: async () => {
      const service = await createTestService('Watcher removal approval');
      const incident = await createTestIncident('Watcher removal approval incident', service.id);
      const watcher = await db.incidentWatcher.create({
        data: { incidentId: incident.id, userId: (await createTestUser()).id, role: 'STAKEHOLDER' },
      });
      return { incidentId: incident.id, target: watcher.id };
    },
    input: async (_f, s) => ({
      args: { path: { id: s.incidentId, watcherId: s.target } },
    }),
    effect: async (_f, s) => db.incidentWatcher.count({ where: { id: s.target } }),
    // A watcher carries no revision: changing its role changes the previewed projection.
    invalidate: async (_f, s) => {
      await db.incidentWatcher.update({ where: { id: s.target }, data: { role: 'FOLLOWER' } });
    },
  },
  {
    name: 'status page asset',
    operationId: 'deleteStatusPageAsset',
    setup: async f => {
      const asset = await db.statusPageAsset.create({
        data: {
          id: randomBytes(32).toString('hex'),
          statusPageId: f.page.id,
          contentType: 'image/png',
          data: Buffer.from('approval-asset-bytes'),
        },
      });
      return { pageId: f.page.id, target: asset.id };
    },
    input: async (_f, s) => ({
      args: { path: { id: s.pageId, assetId: s.target } },
    }),
    effect: async (_f, s) => db.statusPageAsset.count({ where: { id: s.target } }),
    // Content-addressed and immutable: no product path changes an asset, so nothing goes stale;
    // see the out-of-band deletion test below.
  },
];

describeApprovalScenarios(scenarios);

describe('destructive item batch-wide', () => {
  it('keeps every operation out of generic dispatch', async () => {
    const f = await fixture();
    for (const scenario of scenarios) {
      const s = await scenario.setup(f);
      const { args } = await scenario.input(f, s);
      const before = JSON.stringify(await scenario.effect(f, s));
      await expect(
        callMcpOperation(f.ctx(), scenario.operationId, {
          ...args,
          idempotencyKey: 'generic-dispatch-attempt-1',
        }),
        scenario.operationId
      ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
      expect(JSON.stringify(await scenario.effect(f, s)), scenario.operationId).toBe(before);
    }
  });

  it.each(scenarios)(
    'records a verified postcondition after committing $operationId',
    async scenario => {
      const f = await fixture();
      const s = await scenario.setup(f);
      const { args } = await scenario.input(f, s);
      const approval = await prepareMcpOperation(f.ctx(), {
        operationId: scenario.operationId,
        args,
        idempotencyKey: prepareKey(),
      });
      await f.review(approval);
      await expect(
        commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
      ).resolves.toMatchObject({ status: 'COMMITTED' });
      const stored = await db.mcpOperationApproval.findUniqueOrThrow({
        where: { id: approval.approvalId },
      });
      expect(stored.outcome).toMatchObject({ ok: true, postcondition: 'VERIFIED' });
      expect(await scenario.effect(f, s)).toBe(0);
    }
  );

  it.each(scenarios)(
    'shows the target preview to the reviewer but not to the agent for $operationId',
    async scenario => {
      const f = await fixture();
      const s = await scenario.setup(f);
      const { args } = await scenario.input(f, s);
      const prepared = await prepareMcpOperation(f.ctx(), {
        operationId: scenario.operationId,
        args,
        idempotencyKey: prepareKey(),
      });
      const review = await loadMcpOperationReview(prepared.approvalId, f.reviewer);
      expect(review.requiresFreshAuthentication).toBe(true);
      const preview = review.summary.preview;
      expect(preview).toEqual(expect.any(String));
      expect(preview).toContain(s.target);
      const previewed = JSON.parse(preview!) as Record<string, unknown>;
      expect(Object.values(previewed)).toContain(s.target);

      expect(prepared.summary.preview).toBe('[shown to reviewer]');
      const agentFacing = JSON.stringify(prepared);
      expect(agentFacing).not.toContain(preview!);
      // Fields known only from the preview read (not from the agent's own arguments) stay hidden.
      const supplied = new Set<unknown>(Object.values(args.path as Record<string, string>));
      const previewOnly = Object.entries(previewed).filter(([, value]) => !supplied.has(value));
      expect(previewOnly.length).toBeGreaterThan(0);
      for (const [key, value] of previewOnly)
        expect(agentFacing).not.toContain(`"${key}":${JSON.stringify(value)}`);
    }
  );

  it('fails a fresh commit when the immutable asset was deleted out of band', async () => {
    const scenario = scenarios.find(entry => entry.operationId === 'deleteStatusPageAsset')!;
    const f = await fixture();
    const s = await scenario.setup(f);
    const { args } = await scenario.input(f, s);
    const approval = await prepareMcpOperation(f.ctx(), {
      operationId: scenario.operationId,
      args,
      idempotencyKey: prepareKey(),
    });
    await f.review(approval);
    await db.statusPageAsset.delete({ where: { id: s.target } });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: approval.approvalId })
    ).rejects.toThrow('MCP_RESOURCE_UNAVAILABLE');
    const stored = await db.mcpOperationApproval.findUniqueOrThrow({
      where: { id: approval.approvalId },
    });
    expect(stored.status).toBe('FAILED');
    expect(
      await db.auditLog.count({
        where: { entityId: approval.approvalId, action: 'mcp.operation.committed' },
      })
    ).toBe(0);
  });
});
