import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createRunbook: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
  assertCapability: vi.fn(),
  logAudit: vi.fn(),
  settings: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/rbac', () => ({
  assertCapability: mocks.assertCapability,
  getUserPermissions: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  default: {
    systemSettings: mocks.settings,
    $transaction: async (callback: (tx: { systemSettings: typeof mocks.settings }) => unknown) =>
      callback({ systemSettings: mocks.settings }),
  },
}));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/runbooks/versioning', () => ({
  archiveRunbook: vi.fn(),
  cloneVersionToDraft: vi.fn(),
  createRunbook: mocks.createRunbook,
  publishDraftVersion: vi.fn(),
  updateDraftVersion: vi.fn(),
  updateRunbookMetadata: vi.fn(),
}));
vi.mock('@/lib/runbooks/fleet-commands', () => ({ revokeRunbookAgent: vi.fn() }));
vi.mock('@/lib/runbooks/pool-commands', () => ({
  createRunbookAgentPool: vi.fn(),
  updateRunbookAgentPool: vi.fn(),
  updateRunbookAgentMetadata: vi.fn(),
  setRunbookPoolMember: vi.fn(),
  removeRunbookPoolMemberById: vi.fn(),
}));
vi.mock('@/lib/runbooks/execution-signing', () => ({
  stageExecutionSigningKey: vi.fn(),
  activateExecutionSigningKey: vi.fn(),
  retireExecutionSigningKey: vi.fn(),
  RunbookSigningRotationError: class extends Error {},
}));
vi.mock('@/lib/runbooks/agent-auth', () => ({ createAgentEnrollment: vi.fn() }));
vi.mock('@/lib/runbooks/secrets', () => ({
  createRunbookSecretWithGrant: vi.fn(),
  grantRunbookSecret: vi.fn(),
  revokeRunbookSecretGrant: vi.fn(),
  rotateRunbookSecret: vi.fn(),
}));
vi.mock('@/lib/runbooks/lifecycle', () => ({
  checkRunbookDeleteEligibility: vi.fn(),
  deleteRunbook: vi.fn(),
  duplicateRunbook: vi.fn(),
  ensureUniqueSlug: vi.fn(),
  restoreRunbook: vi.fn(),
}));
vi.mock('@/lib/intelligence/ops-insights/handlers', () => ({ enqueueOpsInsights: vi.fn() }));

import {
  createRunbookAction,
  updateIncidentRemediationBudgetAction,
} from '@/app/(app)/runbooks/actions';
import { CAPABILITIES } from '@/lib/authorization';

function form(slug: string) {
  const data = new FormData();
  data.set('name', 'Restart API');
  data.set('slug', slug);
  data.set('description', 'Restarts the API');
  data.set('template', 'empty');
  return data;
}

describe('createRunbookAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCapability.mockResolvedValue({ id: 'user-1' });
  });

  it('returns a slug error, not a thrown unique-constraint error, for an existing slug', async () => {
    mocks.createRunbook.mockRejectedValue(
      Object.assign(new Error('Unique constraint'), { code: 'P2002' })
    );

    const result = await createRunbookAction(form('restart-api'));

    expect(result).toEqual({
      error: 'A runbook with this slug already exists. Choose a different slug.',
    });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it('still rethrows unexpected failures', async () => {
    mocks.createRunbook.mockRejectedValue(new Error('connection lost'));

    await expect(createRunbookAction(form('restart-api'))).rejects.toThrow('connection lost');
  });

  it('redirects to the new runbook on success', async () => {
    mocks.createRunbook.mockResolvedValue({ id: 'rb-1' });

    await createRunbookAction(form('restart-api'));

    expect(mocks.redirect).toHaveBeenCalledWith('/runbooks/rb-1');
  });
});

describe('updateIncidentRemediationBudgetAction', () => {
  const budgetForm = () => {
    const data = new FormData();
    data.set('executions', '100');
    data.set('writes', '100');
    data.set('nonIdempotent', '100');
    return data;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCapability.mockResolvedValue({ id: 'admin-1' });
  });

  it('requires the administrator capability, not the runbook-author one', async () => {
    mocks.assertCapability.mockRejectedValue(new Error('forbidden'));

    await expect(updateIncidentRemediationBudgetAction(budgetForm())).rejects.toThrow('forbidden');

    expect(mocks.assertCapability).toHaveBeenCalledWith(CAPABILITIES.ADMIN_MANAGE);
    expect(mocks.settings.upsert).not.toHaveBeenCalled();
  });

  it('audits the previous ceilings with the new ones', async () => {
    const previous = {
      runbookAutoExecutionsPerIncident: 3,
      runbookAutoWritesPerIncident: 3,
      runbookAutoNonIdempotentPerIncident: 0,
    };
    mocks.settings.findUnique.mockResolvedValue(previous);

    await updateIncidentRemediationBudgetAction(budgetForm());

    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'runbook.incident_budget.updated',
        oldValue: previous,
        newValue: {
          runbookAutoExecutionsPerIncident: 100,
          runbookAutoWritesPerIncident: 100,
          runbookAutoNonIdempotentPerIncident: 100,
        },
      }),
      expect.anything()
    );
  });
});
