import { describe, expect, it } from 'vitest';
import { createTestService, testPrisma as db } from '../helpers/test-db';
import { fixture } from '../helpers/mcp-approval';
import {
  describeApprovalScenarios,
  setupMcpApprovalDatabase,
  type Scenario,
} from '../helpers/mcp-approval-scenarios';
import { emptySnapshot } from '@/lib/automation/contract';
import { changeMode, publishVersion, saveDraft } from '@/lib/automation/versioning';
import { callMcpOperation } from '@/lib/mcp/core/execution';

setupMcpApprovalDatabase();

// Automation is only live when the workspace feature is on; the REST command enforces it.
async function enableAutomation(f: Awaited<ReturnType<typeof fixture>>) {
  await db.systemSettings.upsert({
    where: { id: 'default' },
    create: { automationEnabled: true },
    update: { automationEnabled: true },
  });
  return f.user.id;
}
async function draftWithVersion(actorId: string) {
  const service = await createTestService('Automation approval');
  const draft = await saveDraft({
    serviceId: service.id,
    actorId,
    snapshot: emptySnapshot,
    expectedRevision: 0,
  });
  return { service, draft };
}
const draftRevision = async (serviceId: string) =>
  (await db.automationDraft.findUnique({ where: { serviceId } }))?.revision ?? 0;

const scenarios: Scenario[] = [
  {
    name: 'save draft',
    operationId: 'saveAutomationDraft',
    setup: async f => {
      await enableAutomation(f);
      return { serviceId: (await createTestService('Draft')).id, actorId: f.user.id };
    },
    input: async (_f, s) => ({
      args: { path: { id: s.serviceId }, body: { snapshot: emptySnapshot }, ifMatch: '"0"' },
    }),
    effect: async (_f, s) => draftRevision(s.serviceId),
    invalidate: async (_f, s) => {
      await saveDraft({
        serviceId: s.serviceId,
        actorId: s.actorId,
        snapshot: emptySnapshot,
        expectedRevision: 0,
      });
    },
  },
  {
    name: 'publish version',
    operationId: 'publishAutomationVersion',
    setup: async f => {
      const actorId = await enableAutomation(f);
      const { service } = await draftWithVersion(actorId);
      return { serviceId: service.id, actorId };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.serviceId },
        body: { expectedActiveVersionId: null },
        ifMatch: `"${await draftRevision(s.serviceId)}"`,
      },
    }),
    effect: async (_f, s) =>
      (await db.automationVersion.findMany({ where: { serviceId: s.serviceId } })).map(
        version => version.versionNumber
      ),
    invalidate: async (_f, s) => {
      await saveDraft({
        serviceId: s.serviceId,
        actorId: s.actorId,
        snapshot: emptySnapshot,
        expectedRevision: await draftRevision(s.serviceId),
      });
    },
  },
  {
    name: 'restore draft from a version',
    operationId: 'restoreAutomationDraft',
    setup: async f => {
      const actorId = await enableAutomation(f);
      const { service, draft } = await draftWithVersion(actorId);
      const version = await publishVersion({
        serviceId: service.id,
        actorId,
        expectedRevision: draft.revision,
        expectedActiveVersionId: null,
      });
      return { serviceId: service.id, actorId, versionId: version.id };
    },
    input: async (_f, s) => ({
      args: {
        path: { id: s.serviceId },
        body: { sourceVersionId: s.versionId },
        ifMatch: `"${await draftRevision(s.serviceId)}"`,
      },
    }),
    effect: async (_f, s) => {
      const draft = await db.automationDraft.findUnique({ where: { serviceId: s.serviceId } });
      return [draft?.revision, draft?.restoredFromVersionId ?? null];
    },
    invalidate: async (_f, s) => {
      await saveDraft({
        serviceId: s.serviceId,
        actorId: s.actorId,
        snapshot: emptySnapshot,
        expectedRevision: await draftRevision(s.serviceId),
      });
    },
  },
  {
    name: 'change automation mode',
    operationId: 'updateServiceAutomationMode',
    setup: async f => {
      const actorId = await enableAutomation(f);
      const { service, draft } = await draftWithVersion(actorId);
      const version = await publishVersion({
        serviceId: service.id,
        actorId,
        expectedRevision: draft.revision,
        expectedActiveVersionId: null,
      });
      return { serviceId: service.id, actorId, versionId: version.id };
    },
    input: async (_f, s) => {
      const config = await db.serviceAutomationConfig.findUniqueOrThrow({
        where: { serviceId: s.serviceId },
      });
      return {
        args: {
          path: { id: s.serviceId },
          body: {
            mode: 'SHADOW',
            expectedActiveVersionId: s.versionId,
            acknowledgeNoShadow: true,
          },
          ifMatch: `"${config.revision}"`,
        },
      };
    },
    effect: async (_f, s) =>
      (await db.serviceAutomationConfig.findUnique({ where: { serviceId: s.serviceId } }))?.mode,
    invalidate: async (_f, s) => {
      await changeMode({
        serviceId: s.serviceId,
        actorId: s.actorId,
        mode: 'SHADOW',
        expectedActiveVersionId: s.versionId,
        acknowledgeNoShadow: true,
      });
    },
  },
];

describeApprovalScenarios(scenarios);

describe('automation batch-wide', () => {
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
});
