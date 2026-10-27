import { describe, expect, it } from 'vitest';
import {
  createTestService,
  createTestTeam,
  createTestUser,
  testPrisma as db,
} from '../helpers/test-db';
import { fixture } from '../helpers/mcp-approval';
import {
  describeApprovalScenarios,
  setupMcpApprovalDatabase,
  type Scenario,
} from '../helpers/mcp-approval-scenarios';

setupMcpApprovalDatabase();

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

describeApprovalScenarios(scenarios);

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
