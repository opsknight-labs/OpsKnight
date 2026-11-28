import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertCapability: vi.fn(),
  publishDraftVersion: vi.fn(),
  cloneVersionToDraft: vi.fn(),
  updateRunbookMetadata: vi.fn(),
  archiveRunbook: vi.fn(),
  duplicateRunbook: vi.fn(),
  restoreRunbook: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/rbac', () => ({
  assertCapability: mocks.assertCapability,
  getUserPermissions: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/runbooks/versioning', () => ({
  archiveRunbook: mocks.archiveRunbook,
  cloneVersionToDraft: mocks.cloneVersionToDraft,
  createRunbook: vi.fn(),
  publishDraftVersion: mocks.publishDraftVersion,
  updateDraftVersion: vi.fn(),
  updateRunbookMetadata: mocks.updateRunbookMetadata,
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
  duplicateRunbook: mocks.duplicateRunbook,
  ensureUniqueSlug: vi.fn(),
  restoreRunbook: mocks.restoreRunbook,
}));
vi.mock('@/lib/intelligence/ops-insights/handlers', () => ({ enqueueOpsInsights: vi.fn() }));

import {
  archiveRunbookAction,
  cloneVersionAction,
  duplicateRunbookAction,
  publishDraftAction,
  restoreRunbookAction,
  updateRunbookMetadataAction,
} from '@/app/(app)/runbooks/actions';
import { RunbookArchivedError, RunbookError } from '@/lib/runbooks/errors';

const VERSION_ID = 'cjld2cjxh0000qzrmn831i7rn';
const RUNBOOK_ID = 'cjld2cyuq0000t3rmniod1foy';

describe('runbook lifecycle actions report rule violations to the form', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertCapability.mockResolvedValue({ id: 'user-1' });
  });

  it('returns the domain message for a refused publish instead of throwing', async () => {
    mocks.publishDraftVersion.mockRejectedValue(
      new RunbookError({
        code: 'RUNBOOK_VERSION_IMMUTABLE',
        userMessage:
          'The draft changed since it was validated. Validate it again before publishing.',
      })
    );

    await expect(publishDraftAction(VERSION_ID, RUNBOOK_ID)).resolves.toEqual({
      error: 'The draft changed since it was validated. Validate it again before publishing.',
    });
  });

  it.each([
    ['clone', () => cloneVersionAction(VERSION_ID, RUNBOOK_ID), mocks.cloneVersionToDraft],
    ['restore', () => restoreRunbookAction(RUNBOOK_ID), mocks.restoreRunbook],
    ['duplicate', () => duplicateRunbookAction(RUNBOOK_ID), mocks.duplicateRunbook],
    ['archive', () => archiveRunbookAction(RUNBOOK_ID), mocks.archiveRunbook],
  ] as const)('returns the domain message when %s is refused', async (_name, run, refuse) => {
    refuse.mockRejectedValue(new RunbookArchivedError('Restore Runbook'));

    const result = await run();

    expect(result).toEqual({ error: expect.stringContaining('archived') });
  });

  it('returns the domain message when a stale details sheet is saved', async () => {
    mocks.updateRunbookMetadata.mockRejectedValue(
      new RunbookError({
        code: 'PRECONDITION_FAILED',
        userMessage:
          'This runbook changed since you opened the details. Reopen them and try again.',
      })
    );
    const form = new FormData();
    form.set('name', 'Restart API');
    form.set('slug', 'restart-api');
    form.set('description', '');
    form.set('expectedRevision', '3');

    await expect(updateRunbookMetadataAction(RUNBOOK_ID, form)).resolves.toEqual({
      error: 'This runbook changed since you opened the details. Reopen them and try again.',
    });
  });

  it('still throws errors that are not rule violations, and lets a redirect through', async () => {
    mocks.publishDraftVersion.mockRejectedValue(new Error('connection lost'));
    await expect(publishDraftAction(VERSION_ID, RUNBOOK_ID)).rejects.toThrow('connection lost');

    mocks.archiveRunbook.mockResolvedValue(undefined);
    mocks.redirect.mockImplementation(() => {
      throw new Error('NEXT_REDIRECT');
    });
    await expect(archiveRunbookAction(RUNBOOK_ID)).rejects.toThrow('NEXT_REDIRECT');
  });
});
