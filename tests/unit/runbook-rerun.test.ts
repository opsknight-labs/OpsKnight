import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: { runbookExecution: { findUnique: vi.fn() } },
}));
vi.mock('@/lib/rbac', () => ({
  assertCapability: vi.fn(),
  assertCanViewIncident: vi.fn(),
  assertCanViewService: vi.fn(),
}));
vi.mock('@/lib/runbooks/orchestrator', () => ({
  approveExecutionStep: vi.fn(),
  cancelExecution: vi.fn(),
  previewRunbookExecution: vi.fn(),
  startRunbookExecution: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import prisma from '@/lib/prisma';
import { CAPABILITIES } from '@/lib/authorization';
import { assertCanViewIncident, assertCanViewService, assertCapability } from '@/lib/rbac';
import {
  approveExecutionStep,
  cancelExecution,
  previewRunbookExecution,
  startRunbookExecution,
} from '@/lib/runbooks/orchestrator';
import { redirect } from 'next/navigation';
import { buildRerunRequest, getRerunBlockedReason, type RerunSource } from '@/lib/runbooks/rerun';
import {
  approveExecutionStepAction,
  cancelExecutionAction,
  executeRerunAction,
  previewRerunAction,
} from '@/app/(app)/runbooks/executions/actions';

const EXECUTION_ID = 'clh1234567890123456789012';
const NEW_EXECUTION_ID = 'clh9999999999999999999999';
const STEP_ID = 'clh5555555555555555555555';
const DIGEST = 'a'.repeat(64);
const TOKEN = 'b'.repeat(64);

function source(overrides: Partial<RerunSource> = {}): RerunSource {
  return {
    id: EXECUTION_ID,
    status: 'FAILED',
    runbookId: 'runbook_1',
    incidentId: 'incident_1',
    serviceId: 'service_1',
    bindingId: 'binding_1',
    inputValues: { host: 'web-1' },
    runbook: { archivedAt: null, publishedVersionId: 'version_latest' },
    binding: {
      id: 'binding_1',
      serviceId: 'service_1',
      enabled: true,
      detachedAt: null,
      versionStrategy: 'LATEST_PUBLISHED',
      runbookVersionId: null,
    },
    ...overrides,
  };
}

function previewForm() {
  const data = new FormData();
  data.set('previewDigest', DIGEST);
  data.set('previewAuthorizationToken', TOKEN);
  return data;
}

describe('getRerunBlockedReason', () => {
  it('allows terminal executions with an enabled rule', () => {
    for (const status of ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'])
      expect(getRerunBlockedReason(source({ status }))).toBeNull();
  });

  it('blocks active executions', () => {
    expect(getRerunBlockedReason(source({ status: 'RUNNING' }))).toMatch(/Only finished/);
  });

  it('explains archived runbooks, detached and paused rules', () => {
    expect(
      getRerunBlockedReason(
        source({ runbook: { archivedAt: new Date(), publishedVersionId: 'v' } })
      )
    ).toMatch(/archived/);
    expect(
      getRerunBlockedReason(source({ binding: { ...source().binding!, detachedAt: new Date() } }))
    ).toMatch(/detached/);
    expect(
      getRerunBlockedReason(source({ binding: { ...source().binding!, enabled: false } }))
    ).toMatch(/paused/);
  });

  it('blocks incident runs whose rule no longer exists', () => {
    expect(getRerunBlockedReason(source({ binding: null }))).toMatch(/no longer exists/);
  });

  it('allows incident runs that were intentionally unbound to be re-run', () => {
    expect(
      getRerunBlockedReason(
        source({
          incidentId: 'incident_1',
          binding: null,
          bindingId: null,
          triggerId: null,
          triggerFingerprint: null,
        })
      )
    ).toBeNull();
  });

  it('blocks when no runnable version exists', () => {
    expect(
      getRerunBlockedReason(
        source({
          incidentId: null,
          binding: null,
          bindingId: null,
          runbook: { archivedAt: null, publishedVersionId: null },
        })
      )
    ).toMatch(/no published version/);
  });
});

describe('buildRerunRequest', () => {
  it('uses the rule version strategy and saved rule inputs for bound runs', () => {
    expect(buildRerunRequest(source(), 'user_1')).toEqual({
      runbookId: 'runbook_1',
      runbookVersionId: 'version_latest',
      serviceId: 'service_1',
      incidentId: 'incident_1',
      bindingId: 'binding_1',
      inputValues: undefined,
      triggeredByUserId: 'user_1',
    });
    expect(
      buildRerunRequest(
        source({
          binding: {
            ...source().binding!,
            versionStrategy: 'PINNED',
            runbookVersionId: 'version_pinned',
          },
        }),
        'user_1'
      ).runbookVersionId
    ).toBe('version_pinned');
  });

  it('replays original input values for unbound runs', () => {
    expect(
      buildRerunRequest(source({ incidentId: null, binding: null, bindingId: null }), 'user_1')
    ).toMatchObject({
      bindingId: undefined,
      inputValues: { host: 'web-1' },
      runbookVersionId: 'version_latest',
    });
  });

  it('preserves target agent and pool for unbound runs', () => {
    expect(
      buildRerunRequest(
        source({
          incidentId: 'incident_1',
          binding: null,
          bindingId: null,
          resolvedTargetAgentId: 'agent_target',
          resolvedTargetAgentPoolId: 'pool_target',
        }),
        'user_1'
      )
    ).toMatchObject({
      bindingId: undefined,
      targetAgentId: 'agent_target',
      targetAgentPoolId: 'pool_target',
    });
  });
});

describe('re-run server actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertCapability).mockResolvedValue({ id: 'user_1' } as never);
    vi.mocked(prisma.runbookExecution.findUnique).mockResolvedValue(source() as never);
  });

  it('previews through the existing orchestrator after execute, read and incident checks', async () => {
    vi.mocked(previewRunbookExecution).mockResolvedValue({ digest: DIGEST } as never);
    const result = await previewRerunAction(EXECUTION_ID);
    expect(assertCapability).toHaveBeenCalledWith(CAPABILITIES.RUNBOOK_EXECUTE);
    expect(assertCapability).toHaveBeenCalledWith(CAPABILITIES.RUNBOOK_READ_ALL);
    expect(assertCanViewIncident).toHaveBeenCalledWith('incident_1');
    expect(previewRunbookExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        runbookId: 'runbook_1',
        bindingId: 'binding_1',
        triggeredByUserId: 'user_1',
      })
    );
    expect(result).toEqual({ preview: { digest: DIGEST } });
  });

  it('checks service visibility for service-only runs', async () => {
    vi.mocked(prisma.runbookExecution.findUnique).mockResolvedValue(
      source({ incidentId: null }) as never
    );
    await previewRerunAction(EXECUTION_ID);
    expect(assertCanViewService).toHaveBeenCalledWith('service_1');
    expect(assertCanViewIncident).not.toHaveBeenCalled();
  });

  it('never previews or starts without capability', async () => {
    vi.mocked(assertCapability).mockRejectedValue(new Error('denied'));
    expect(await previewRerunAction(EXECUTION_ID)).toHaveProperty('error');
    expect(await executeRerunAction(EXECUTION_ID, previewForm())).toHaveProperty('error');
    expect(previewRunbookExecution).not.toHaveBeenCalled();
    expect(startRunbookExecution).not.toHaveBeenCalled();
  });

  it('returns the blocked reason instead of previewing', async () => {
    vi.mocked(prisma.runbookExecution.findUnique).mockResolvedValue(
      source({ binding: { ...source().binding!, detachedAt: new Date() } }) as never
    );
    const result = await previewRerunAction(EXECUTION_ID);
    expect(result.error).toMatch(/detached/);
    expect(previewRunbookExecution).not.toHaveBeenCalled();
  });

  it('starts only with the previewed digest and authorization token', async () => {
    vi.mocked(startRunbookExecution).mockResolvedValue({ id: NEW_EXECUTION_ID } as never);
    await executeRerunAction(EXECUTION_ID, previewForm());
    expect(startRunbookExecution).toHaveBeenCalledWith(
      expect.objectContaining({
        runbookId: 'runbook_1',
        bindingId: 'binding_1',
        expectedPlanDigest: DIGEST,
        previewAuthorizationToken: TOKEN,
        triggeredByUserId: 'user_1',
      })
    );
    expect(redirect).toHaveBeenCalledWith(`/runbooks/executions/${NEW_EXECUTION_ID}`);
  });

  it('rejects execution without a preview', async () => {
    const result = await executeRerunAction(EXECUTION_ID, new FormData());
    expect(result).toHaveProperty('error');
    expect(startRunbookExecution).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('cancels with execute capability and incident scope', async () => {
    vi.mocked(prisma.runbookExecution.findUnique).mockResolvedValue({
      id: EXECUTION_ID,
      incidentId: 'incident_1',
      serviceId: 'service_1',
    } as never);
    await cancelExecutionAction(EXECUTION_ID);
    expect(assertCapability).toHaveBeenCalledWith(CAPABILITIES.RUNBOOK_EXECUTE);
    expect(assertCanViewIncident).toHaveBeenCalledWith('incident_1');
    expect(cancelExecution).toHaveBeenCalledWith(EXECUTION_ID, 'user_1', expect.any(String));
  });

  it('approves with approve capability and the exact plan digest', async () => {
    vi.mocked(prisma.runbookExecution.findUnique).mockResolvedValue({
      id: EXECUTION_ID,
      incidentId: null,
      serviceId: 'service_1',
    } as never);
    await approveExecutionStepAction(EXECUTION_ID, STEP_ID, DIGEST);
    expect(assertCapability).toHaveBeenCalledWith(CAPABILITIES.RUNBOOK_APPROVE);
    expect(assertCanViewService).toHaveBeenCalledWith('service_1');
    expect(approveExecutionStep).toHaveBeenCalledWith({
      executionId: EXECUTION_ID,
      stepId: STEP_ID,
      planDigest: DIGEST,
      actorId: 'user_1',
    });
  });

  it('does not approve with a malformed digest', async () => {
    vi.mocked(prisma.runbookExecution.findUnique).mockResolvedValue({
      id: EXECUTION_ID,
      incidentId: null,
      serviceId: null,
    } as never);
    expect(await approveExecutionStepAction(EXECUTION_ID, STEP_ID, 'short')).toHaveProperty(
      'error'
    );
    expect(approveExecutionStep).not.toHaveBeenCalled();
  });
});
