import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createRunbook: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/rbac', () => ({
  assertCapability: vi.fn().mockResolvedValue({ id: 'user-1' }),
  getUserPermissions: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
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

import { createRunbookAction } from '@/app/(app)/runbooks/actions';

function form(slug: string) {
  const data = new FormData();
  data.set('name', 'Restart API');
  data.set('slug', slug);
  data.set('description', 'Restarts the API');
  data.set('template', 'empty');
  return data;
}

describe('createRunbookAction', () => {
  beforeEach(() => vi.clearAllMocks());

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
