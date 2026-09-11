import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: mocks.transaction,
    externalOperation: { updateMany: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/jira', () => ({
  createJiraIssue: vi.fn(),
  findJiraIssueByCorrelationLabel: vi.fn(),
  addJiraComment: vi.fn(),
  hasJiraCommentMarker: vi.fn(),
}));
vi.mock('@/lib/jira-concurrency', () => ({
  JIRA_PROVIDER_FENCE_MAX_WAIT_MS: 5_000,
  JIRA_PROVIDER_FENCE_TIMEOUT_MS: 40_000,
  acquireJiraWorkspaceProviderFence: vi.fn(),
  acquireJiraActionItemLinkFence: vi.fn(),
  acquireJiraExternalIssueLinkFence: vi.fn(),
}));
vi.mock('@/lib/provider-admission', () => ({
  assertProviderAdmitted: vi.fn(),
  recordProviderFailure: vi.fn(),
  recordProviderSuccess: vi.fn(),
}));

import { enqueueJiraCreateOperation } from '@/lib/external-operations';

describe('Jira create ownership invariant', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects missing and dual owners before writing a durable operation', async () => {
    await expect(
      enqueueJiraCreateOperation({ projectKey: 'OPS', issueType: 'Task', summary: 'No owner' })
    ).rejects.toThrow('exactly one OpsKnight entity');

    await expect(
      enqueueJiraCreateOperation({
        incidentId: 'inc-1',
        actionItemId: 'action-1',
        projectKey: 'OPS',
        issueType: 'Task',
        summary: 'Two owners',
      })
    ).rejects.toThrow('exactly one OpsKnight entity');

    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
