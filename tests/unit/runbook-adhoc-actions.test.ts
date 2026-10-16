import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCapability: vi.fn(),
  assertCanViewIncident: vi.fn(),
  getUserPermissions: vi.fn(),
  incidentFindUnique: vi.fn(),
  runbookFindFirst: vi.fn(),
  runbookFindMany: vi.fn(),
  agentFindMany: vi.fn(),
  poolFindMany: vi.fn(),
  ruleFindFirst: vi.fn(),
  preview: vi.fn(),
  start: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  assertCapability: mocks.assertCapability,
  assertCanViewIncident: mocks.assertCanViewIncident,
  getUserPermissions: mocks.getUserPermissions,
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('@/lib/prisma', () => ({
  default: {
    incident: { findUnique: mocks.incidentFindUnique },
    runbook: { findFirst: mocks.runbookFindFirst, findMany: mocks.runbookFindMany },
    runbookAgent: { findMany: mocks.agentFindMany },
    runbookAgentPool: { findMany: mocks.poolFindMany },
    serviceAutomationRule: { findFirst: mocks.ruleFindFirst },
  },
}));
vi.mock('@/lib/runbooks/orchestrator', () => ({
  previewRunbookExecution: mocks.preview,
  startRunbookExecution: mocks.start,
  approveExecutionStep: vi.fn(),
  cancelExecution: vi.fn(),
}));

import {
  executeAdhocIncidentRunbookAction,
  loadAdhocIncidentRunbookAction,
  previewAdhocIncidentRunbookAction,
  searchAdhocIncidentRunbooksAction,
} from '@/components/incident/runbook-actions';
import { CAPABILITIES } from '@/lib/authorization';

const INCIDENT = 'cincident0001';
const SERVICE = 'cservice00001';
const RUNBOOK = 'crunbook00001';
const AGENT = 'cagent0000001';
const POOL = 'cpool00000001';
const DIGEST = 'a'.repeat(64);
const TOKEN = 'b'.repeat(64);

const publishedRunbook = {
  id: RUNBOOK,
  name: 'Restart API',
  description: 'Restarts the API unit',
  publishedVersion: {
    id: 'cversion00001',
    version: 3,
    definition: {
      steps: [
        {
          key: 'status',
          name: 'Status',
          type: 'SYSTEMD',
          riskClass: 'READ_ONLY',
          config: { action: 'status', unit: 'api.service' },
        },
      ],
    },
    inputs: [
      { key: 'unit', type: 'STRING', label: 'Unit', required: true, options: [] },
      { key: 'count', type: 'NUMBER', label: 'Count', required: false, options: [] },
      { key: 'force', type: 'BOOLEAN', label: 'Force', required: false, options: [] },
      { key: 'token', type: 'SECRET_REF', label: 'Token', required: false, options: [] },
      { key: 'mode', type: 'SELECT', label: 'Mode', required: false, options: ['fast', 'safe'] },
    ],
  },
};

function form(entries: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

describe('ad-hoc incident runbook actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCapability.mockResolvedValue({ id: 'cuser00000001', role: 'ADMIN' });
    mocks.getUserPermissions.mockResolvedValue({
      id: 'cuser00000001',
      role: 'ADMIN',
      capabilities: [CAPABILITIES.RUNBOOK_EXECUTE, CAPABILITIES.RUNBOOK_READ_ALL],
    });
    mocks.assertCanViewIncident.mockResolvedValue(undefined);
    mocks.incidentFindUnique.mockResolvedValue({ id: INCIDENT, serviceId: SERVICE });
    mocks.runbookFindFirst.mockResolvedValue(publishedRunbook);
    mocks.preview.mockResolvedValue({ digest: DIGEST, authorizationToken: TOKEN });
    mocks.start.mockResolvedValue({ id: 'cexecution001' });
    mocks.ruleFindFirst.mockResolvedValue({ id: 'crule00001' });
  });

  it('requires RUNBOOK_EXECUTE and incident access before previewing', async () => {
    mocks.assertCapability.mockRejectedValue(new Error('Forbidden'));
    const result = await previewAdhocIncidentRunbookAction(INCIDENT, RUNBOOK, form({}));
    expect(result).toHaveProperty('error');
    expect(mocks.assertCapability).toHaveBeenCalledWith(CAPABILITIES.RUNBOOK_EXECUTE);
    expect(mocks.assertCanViewIncident).toHaveBeenCalledWith(INCIDENT);
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('fails closed when the incident is not visible', async () => {
    mocks.assertCanViewIncident.mockRejectedValue(new Error('Forbidden incident'));
    expect(await previewAdhocIncidentRunbookAction(INCIDENT, RUNBOOK, form({}))).toHaveProperty(
      'error'
    );
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('previews with the incident service, no rule and server-resolved published version', async () => {
    const result = await previewAdhocIncidentRunbookAction(
      INCIDENT,
      RUNBOOK,
      form({
        'input:unit': 'api.service',
        'input:count': '2',
        'input:force': 'true',
        'input:token': 'deploy-token',
        'input:mode': 'safe',
        executionTarget: `agent:${AGENT}`,
        runbookVersionId: 'cforgedversion',
      })
    );
    expect(result).toEqual({ preview: { digest: DIGEST, authorizationToken: TOKEN } });
    expect(mocks.runbookFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: RUNBOOK,
          archivedAt: null,
          publishedVersion: { is: { state: 'PUBLISHED' } },
        },
      })
    );
    const request = mocks.preview.mock.calls[0][0];
    expect(request).toEqual({
      runbookId: RUNBOOK,
      serviceId: SERVICE,
      incidentId: INCIDENT,
      inputValues: {
        unit: 'api.service',
        count: 2,
        force: true,
        token: 'secret://deploy-token',
        mode: 'safe',
      },
      targetAgentId: AGENT,
      triggeredByUserId: 'cuser00000001',
    });
    expect(request).not.toHaveProperty('bindingId');
    expect(request).not.toHaveProperty('runbookVersionId');
  });

  it('passes a pool target and treats "none" as no target', async () => {
    await previewAdhocIncidentRunbookAction(
      INCIDENT,
      RUNBOOK,
      form({ 'input:unit': 'x', executionTarget: `pool:${POOL}` })
    );
    expect(mocks.preview.mock.calls[0][0]).toMatchObject({ targetAgentPoolId: POOL });
    await previewAdhocIncidentRunbookAction(
      INCIDENT,
      RUNBOOK,
      form({ 'input:unit': 'x', executionTarget: 'none' })
    );
    expect(mocks.preview.mock.calls[1][0]).not.toHaveProperty('targetAgentId');
    expect(mocks.preview.mock.calls[1][0]).not.toHaveProperty('targetAgentPoolId');
  });

  it('rejects malformed targets, unknown inputs and unpublished runbooks', async () => {
    for (const data of [
      form({ executionTarget: 'host:evil' }),
      form({ executionTarget: 'agent:not a cuid' }),
      form({ 'input:unexpected': '1' }),
      form({ 'input:count': 'NaN-ish' }),
    ]) {
      expect(await previewAdhocIncidentRunbookAction(INCIDENT, RUNBOOK, data)).toHaveProperty(
        'error'
      );
    }
    mocks.runbookFindFirst.mockResolvedValue(null);
    expect(await previewAdhocIncidentRunbookAction(INCIDENT, RUNBOOK, form({}))).toHaveProperty(
      'error'
    );
    expect(mocks.preview).not.toHaveBeenCalled();
  });

  it('requires a preview digest and authorization token to execute', async () => {
    expect(
      await executeAdhocIncidentRunbookAction(INCIDENT, RUNBOOK, form({ previewDigest: DIGEST }))
    ).toHaveProperty('error');
    expect(
      await executeAdhocIncidentRunbookAction(
        INCIDENT,
        RUNBOOK,
        form({ previewAuthorizationToken: TOKEN })
      )
    ).toHaveProperty('error');
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('executes through the orchestrator with the previewed digest and token', async () => {
    const result = await executeAdhocIncidentRunbookAction(
      INCIDENT,
      RUNBOOK,
      form({
        previewDigest: DIGEST,
        previewAuthorizationToken: TOKEN,
        'input:unit': 'api.service',
        executionTarget: `agent:${AGENT}`,
      })
    );
    expect(result).toBeUndefined();
    expect(mocks.start).toHaveBeenCalledWith(
      expect.objectContaining({
        runbookId: RUNBOOK,
        serviceId: SERVICE,
        incidentId: INCIDENT,
        targetAgentId: AGENT,
        expectedPlanDigest: DIGEST,
        previewAuthorizationToken: TOKEN,
        triggeredByUserId: 'cuser00000001',
      })
    );
    expect(mocks.start.mock.calls[0][0]).not.toHaveProperty('bindingId');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/incidents/${INCIDENT}`);
  });

  it('surfaces orchestrator rejections as errors', async () => {
    mocks.start.mockRejectedValue(new Error('PREVIEW_STALE'));
    expect(
      await executeAdhocIncidentRunbookAction(
        INCIDENT,
        RUNBOOK,
        form({ previewDigest: DIGEST, previewAuthorizationToken: TOKEN, 'input:unit': 'x' })
      )
    ).toHaveProperty('error');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('searches only published, non-archived runbooks', async () => {
    mocks.runbookFindMany.mockResolvedValue([
      { id: RUNBOOK, name: 'Restart API', description: '', publishedVersion: { version: 3 } },
    ]);
    expect(await searchAdhocIncidentRunbooksAction(INCIDENT, ' restart ')).toEqual([
      { id: RUNBOOK, name: 'Restart API', description: '', version: 3 },
    ]);
    expect(mocks.runbookFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          archivedAt: null,
          publishedVersion: { is: { state: 'PUBLISHED' } },
          name: { contains: 'restart', mode: 'insensitive' },
        },
      })
    );
  });

  it('refuses search without execute capability', async () => {
    mocks.assertCapability.mockRejectedValue(new Error('Forbidden'));
    await expect(searchAdhocIncidentRunbooksAction(INCIDENT, '')).rejects.toThrow('Forbidden');
    expect(mocks.runbookFindMany).not.toHaveBeenCalled();
  });

  it('loads published inputs (with SELECT options) and agent requirement', async () => {
    mocks.agentFindMany.mockResolvedValue([]);
    mocks.poolFindMany.mockResolvedValue([]);
    const result = await loadAdhocIncidentRunbookAction(INCIDENT, RUNBOOK);
    if (!('runbook' in result) || !result.runbook) throw new Error('expected runbook');
    expect(result.runbook).toMatchObject({
      id: RUNBOOK,
      version: 3,
      requiresAgent: true,
      hasAgentWrite: false,
      hasWrite: false,
    });
    expect(result.runbook.inputs.find(input => input.key === 'mode')?.options).toEqual([
      'fast',
      'safe',
    ]);
    expect(result.runbook).not.toHaveProperty('definition');
  });

  it('restricts ad-hoc search to incident service when user only has RUNBOOK_READ_SCOPED', async () => {
    mocks.getUserPermissions.mockResolvedValue({
      id: 'cuser00000001',
      role: 'USER',
      capabilities: [CAPABILITIES.RUNBOOK_EXECUTE, CAPABILITIES.RUNBOOK_READ_SCOPED],
    });
    mocks.runbookFindMany.mockResolvedValue([
      { id: RUNBOOK, name: 'Restart API', description: '', publishedVersion: { version: 3 } },
    ]);
    await searchAdhocIncidentRunbooksAction(INCIDENT, 'restart');
    expect(mocks.runbookFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          serviceAutomationRules: {
            some: {
              serviceId: SERVICE,
              enabled: true,
              detachedAt: null,
            },
          },
        }),
      })
    );
  });

  it('rejects ad-hoc preview when scoped reader accesses runbook not bound to incident service', async () => {
    mocks.getUserPermissions.mockResolvedValue({
      id: 'cuser00000001',
      role: 'USER',
      capabilities: [CAPABILITIES.RUNBOOK_EXECUTE, CAPABILITIES.RUNBOOK_READ_SCOPED],
    });
    mocks.ruleFindFirst.mockResolvedValue(null);
    const result = await previewAdhocIncidentRunbookAction(INCIDENT, RUNBOOK, form({}));
    expect(result).toHaveProperty(
      'error',
      'Runbook access denied: runbook is not attached to this incident’s service.'
    );
    expect(mocks.preview).not.toHaveBeenCalled();
  });
});
