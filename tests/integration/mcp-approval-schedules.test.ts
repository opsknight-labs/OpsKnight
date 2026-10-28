import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTestUser, testPrisma as db } from '../helpers/test-db';
import { fixture, type Fixture } from '../helpers/mcp-approval';
import {
  describeApprovalScenarios,
  prepareKey,
  setupMcpApprovalDatabase,
  type Scenario,
} from '../helpers/mcp-approval-scenarios';
import { callMcpOperation } from '@/lib/mcp/core/execution';
import {
  commitApprovedMcpOperation,
  mcpApprovalCommitKey,
  prepareMcpOperation,
} from '@/lib/mcp/approvals/operation';

setupMcpApprovalDatabase();

const suffix = () => randomBytes(4).toString('hex');
const layerValues = {
  start: '2026-01-05T00:00:00.000Z',
  end: null,
  rotationLengthHours: 168,
  shiftLengthHours: null,
  restrictions: null,
};

// Two layers with distinct priorities and two ordered responders on the first layer.
async function scheduleFixture() {
  const [first, second] = [
    await createTestUser({ role: 'USER' }),
    await createTestUser({ role: 'USER' }),
  ];
  const schedule = await db.onCallSchedule.create({ data: { name: `Approval ${suffix()}` } });
  const primary = await db.onCallLayer.create({
    data: {
      scheduleId: schedule.id,
      name: 'Primary',
      start: new Date(layerValues.start),
      priority: 2,
      users: {
        create: [
          { userId: first.id, position: 1 },
          { userId: second.id, position: 2 },
        ],
      },
    },
  });
  const secondary = await db.onCallLayer.create({
    data: {
      scheduleId: schedule.id,
      name: 'Secondary',
      start: new Date(layerValues.start),
      priority: 1,
    },
  });
  return {
    scheduleId: schedule.id,
    layerId: primary.id,
    secondaryId: secondary.id,
    firstId: first.id,
    secondId: second.id,
  };
}
const layer = (s: Record<string, string>) =>
  db.onCallLayer.findUniqueOrThrow({ where: { id: s.layerId } });
const scheduleRevision = async (s: Record<string, string>) =>
  (await db.onCallSchedule.findUniqueOrThrow({ where: { id: s.scheduleId } })).revision;
const participants = async (layerId: string) =>
  (await db.onCallLayerUser.findMany({ where: { layerId }, orderBy: { position: 'asc' } })).map(
    row => row.userId
  );
const layerNames = async (s: Record<string, string>) =>
  (
    await db.onCallLayer.findMany({
      where: { scheduleId: s.scheduleId },
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
    })
  ).map(row => row.name);

const scenarios: Scenario[] = [
  {
    name: 'update layer',
    operationId: 'updateScheduleLayer',
    setup: async () => scheduleFixture(),
    input: async (_f, s) => ({
      args: {
        path: { id: s.scheduleId, layerId: s.layerId },
        body: { ...layerValues, name: 'Reviewed primary', rotationLengthHours: 72 },
        ifMatch: `"${(await layer(s)).revision}"`,
      },
    }),
    effect: async (_f, s) => {
      const row = await layer(s);
      return [row.name, row.rotationLengthHours, row.revision];
    },
    invalidate: async (_f, s) => {
      await db.onCallLayer.update({ where: { id: s.layerId }, data: { name: 'Moved on' } });
    },
  },
  {
    name: 'move participant',
    operationId: 'moveScheduleParticipant',
    setup: async () => scheduleFixture(),
    input: async (_f, s) => ({
      args: {
        path: { id: s.scheduleId, layerId: s.layerId, userId: s.secondId },
        body: { direction: 'up' },
      },
    }),
    effect: async (_f, s) => participants(s.layerId),
  },
  {
    name: 'create schedule',
    operationId: 'createSchedule',
    setup: async () => ({ name: `Reviewed schedule ${suffix()}` }),
    input: async (_f, s) => ({ args: { body: { name: s.name, timeZone: 'Europe/London' } } }),
    effect: async (_f, s) =>
      (await db.onCallSchedule.findMany({ where: { name: s.name } })).map(row => row.timeZone),
  },
  {
    name: 'create layer',
    operationId: 'createScheduleLayer',
    setup: async () => {
      const s = await scheduleFixture();
      return { ...s, responderId: (await createTestUser({ role: 'USER' })).id };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.scheduleId },
        body: { ...layerValues, name: 'Reviewed layer', responderIds: [s.responderId] },
      },
    }),
    effect: async (_f, s) =>
      (
        await db.onCallLayer.findMany({
          where: { scheduleId: s.scheduleId, name: 'Reviewed layer' },
          include: { users: true },
        })
      ).map(row => row.users.map(user => user.userId)),
  },
  {
    name: 'add participant',
    operationId: 'addScheduleParticipant',
    setup: async () => {
      const s = await scheduleFixture();
      return { ...s, responderId: (await createTestUser({ role: 'USER' })).id };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.scheduleId, layerId: s.secondaryId },
        body: { userId: s.responderId },
      },
    }),
    effect: async (_f, s) => participants(s.secondaryId),
  },
  {
    name: 'reorder layers',
    operationId: 'reorderScheduleLayers',
    setup: async () => scheduleFixture(),
    input: async (_f, s) => ({
      args: {
        path: { id: s.scheduleId },
        body: { orderedIds: [s.secondaryId, s.layerId] },
        ifMatch: `"${await scheduleRevision(s)}"`,
      },
    }),
    effect: async (_f, s) => layerNames(s),
    invalidate: async (_f, s) => {
      await db.onCallSchedule.update({
        where: { id: s.scheduleId },
        data: { name: `Moved on ${suffix()}` },
      });
    },
  },
];

describeApprovalScenarios(scenarios);

const scenario = (operationId: string) =>
  scenarios.find(candidate => candidate.operationId === operationId)!;
async function approve(f: Fixture, operationId: string, s: Record<string, string>) {
  const { args } = await scenario(operationId).input(f, s);
  const prepared = await prepareMcpOperation(f.ctx(), {
    operationId,
    args,
    idempotencyKey: prepareKey(),
  });
  await f.review(prepared);
  return prepared;
}

describe('schedule batch-wide', () => {
  it('keeps every operation out of generic dispatch', async () => {
    const f = await fixture();
    for (const candidate of scenarios)
      await expect(
        callMcpOperation(f.ctx(), candidate.operationId, {
          path: {
            id: 'cmcpgenericdispatch0000001',
            layerId: 'cmcpgenericdispatch0000002',
            userId: 'cmcpgenericdispatch0000003',
          },
          body: {},
          idempotencyKey: 'generic-dispatch-attempt-1',
          ifMatch: '"1"',
        })
      ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
  });

  it('commits the observability-wrapped schedule create through the shared idempotency receipt', async () => {
    const f = await fixture();
    const s = await scenario('createSchedule').setup(f);
    const prepared = await approve(f, 'createSchedule', s);
    await commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId });
    expect(
      await db.backgroundJob.count({
        where: {
          id: {
            startsWith: 'idem:',
            endsWith: `:mcp:${f.grant.id}:${mcpApprovalCommitKey(prepared.approvalId)}`,
          },
        },
      })
    ).toBe(1);
    expect(await scenario('createSchedule').effect(f, s)).toEqual(['Europe/London']);
  });

  // Routes without If-Match: the frozen request names exact ids, and the domain command
  // re-validates current membership at commit, so a changed target is refused without effect.
  it('refuses a frozen participant move once the participant has left the layer', async () => {
    const f = await fixture();
    const s = await scenario('moveScheduleParticipant').setup(f);
    const prepared = await approve(f, 'moveScheduleParticipant', s);
    await db.onCallLayerUser.deleteMany({ where: { layerId: s.layerId, userId: s.secondId } });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_DOMAIN_REJECTED');
    expect(await participants(s.layerId)).toEqual([s.firstId]);
  });

  it('refuses a frozen participant add once the responder is already on the schedule', async () => {
    const f = await fixture();
    const s = await scenario('addScheduleParticipant').setup(f);
    const prepared = await approve(f, 'addScheduleParticipant', s);
    await db.onCallLayerUser.create({
      data: { layerId: s.layerId, userId: s.responderId, position: 3 },
    });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_DOMAIN_REJECTED');
    expect(await participants(s.secondaryId)).toEqual([]);
  });

  it('refuses a frozen layer create once its responder is assigned elsewhere in the schedule', async () => {
    const f = await fixture();
    const s = await scenario('createScheduleLayer').setup(f);
    const prepared = await approve(f, 'createScheduleLayer', s);
    await db.onCallLayerUser.create({
      data: { layerId: s.secondaryId, userId: s.responderId, position: 1 },
    });
    await expect(
      commitApprovedMcpOperation(f.ctx(), { approvalId: prepared.approvalId })
    ).rejects.toThrow('MCP_DOMAIN_REJECTED');
    expect(await scenario('createScheduleLayer').effect(f, s)).toEqual([]);
  });
});
