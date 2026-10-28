import { describe, expect, it } from 'vitest';
import { testPrisma as db } from '../helpers/test-db';
import { fixture } from '../helpers/mcp-approval';
import {
  describeApprovalScenarios,
  setupMcpApprovalDatabase,
  type Scenario,
} from '../helpers/mcp-approval-scenarios';
import { getAutomationSettings } from '@/lib/automation/settings';
import { readRunbookSettings } from '@/lib/runbooks/settings-commands';
import { callMcpOperation } from '@/lib/mcp/core/execution';

setupMcpApprovalDatabase();

// Every target here is a workspace-wide singleton, so each input reads the live revision and
// each effect is that revision (plus the reviewed value where the command can no-op).
const automationRevision = async () => (await getAutomationSettings(db)).automationSettingsRevision;
const runbookSettings = () => readRunbookSettings(db);
const chatOpsRevision = async () =>
  (await db.chatOpsConfig.findUnique({ where: { id: 'default' } }))?.revision ?? 0;
const workspaceSlaVersion = async () =>
  (
    await db.incidentSlaPolicy.findFirst({
      where: { scopeKey: 'workspace', sealedAt: { not: null } },
      orderBy: { version: 'desc' },
    })
  )?.version ?? 0;

const chatOps = {
  enabled: true,
  channelPrefix: 'incident',
  autoCreateOnUrgency: ['HIGH'],
  autoCreateOnPriority: ['P1', 'P2'],
  archiveOnResolve: true,
  defaultVideoBridge: 'JITSI',
  customBridgeUrlTemplate: 'https://bridge.example.com/{incidentId}',
  defaultProviders: ['SLACK', 'MICROSOFT_TEAMS'],
};

const scenarios: Scenario[] = [
  {
    name: 'automation settings',
    operationId: 'updateAutomationSettings',
    setup: async () => ({}),
    // Kept OFF so the command never conflicts with services already in SHADOW/LIVE.
    input: async () => ({
      args: {
        body: { automationEnabled: false, automationTraceRetentionDays: 30 },
        ifMatch: `"${await automationRevision()}"`,
      },
    }),
    effect: automationRevision,
    invalidate: async () => {
      await db.systemSettings.upsert({
        where: { id: 'default' },
        create: { automationSettingsRevision: 1 },
        update: { automationSettingsRevision: { increment: 1 } },
      });
    },
  },
  {
    name: 'runbook settings',
    operationId: 'updateRunbookSettings',
    // The command no-ops on unchanged values, so always request a different budget.
    setup: async () => ({
      target: String(((await runbookSettings()).runbookAutoExecutionsPerIncident + 1) % 100),
    }),
    input: async (_f, s) => ({
      args: {
        body: { runbookAutoExecutionsPerIncident: Number(s.target) },
        ifMatch: `"${(await runbookSettings()).runbookSettingsRevision}"`,
      },
    }),
    effect: async () => {
      const settings = await runbookSettings();
      return [settings.runbookSettingsRevision, settings.runbookAutoExecutionsPerIncident];
    },
    invalidate: async () => {
      const current = await runbookSettings();
      await db.systemSettings.upsert({
        where: { id: 'default' },
        create: { runbookAutoWritesPerIncident: (current.runbookAutoWritesPerIncident + 1) % 100 },
        update: { runbookAutoWritesPerIncident: (current.runbookAutoWritesPerIncident + 1) % 100 },
      });
    },
  },
  {
    name: 'ChatOps configuration',
    operationId: 'updateChatOpsConfiguration',
    setup: async () => ({}),
    input: async () => ({ args: { body: chatOps, ifMatch: `"${await chatOpsRevision()}"` } }),
    effect: chatOpsRevision,
    invalidate: async () => {
      await db.chatOpsConfig.upsert({
        where: { id: 'default' },
        create: { id: 'default', channelPrefix: 'moved' },
        update: { channelPrefix: 'moved' },
      });
    },
  },
  {
    name: 'workspace SLA policy',
    operationId: 'updateWorkspaceSlaPolicy',
    setup: async () => ({}),
    input: async () => ({
      args: {
        body: {
          baseAckTargetMs: 300000,
          baseResolveTargetMs: 3600000,
          rules: [{ priority: 'P1', ackTargetMs: 60000, resolveTargetMs: 600000 }],
        },
        ifMatch: `"${await workspaceSlaVersion()}"`,
      },
    }),
    effect: workspaceSlaVersion,
    invalidate: async () => {
      await db.incidentSlaPolicy.create({
        data: {
          scopeKey: 'workspace',
          version: (await workspaceSlaVersion()) + 1,
          inheritWorkspace: false,
          baseAckTargetMs: 900000,
          baseResolveTargetMs: 7200000,
          sealedAt: new Date(),
        },
      });
    },
  },
];

describeApprovalScenarios(scenarios);

describe('settings approval batch-wide', () => {
  it('keeps every operation out of generic dispatch', async () => {
    const f = await fixture();
    for (const scenario of scenarios)
      await expect(
        callMcpOperation(f.ctx(), scenario.operationId, {
          body: {},
          idempotencyKey: 'generic-dispatch-attempt-1',
          ifMatch: '"1"',
        })
      ).rejects.toThrow('MCP_OPERATION_UNAVAILABLE');
  });
});
