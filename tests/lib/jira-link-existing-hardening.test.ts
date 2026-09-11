import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    externalIssueLink: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };
  return {
    getJiraIssue: vi.fn(),
    transaction: vi.fn(),
    acquireJiraExternalIssueLinkFence: vi.fn(),
    getDefaultActorId: vi.fn(),
    logAudit: vi.fn(),
    tx,
  };
});

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/jira', () => ({ getJiraIssue: mocks.getJiraIssue }));
vi.mock('@/lib/jira-concurrency', () => ({
  acquireJiraExternalIssueLinkFence: mocks.acquireJiraExternalIssueLinkFence,
}));
vi.mock('@/lib/audit', () => ({
  getDefaultActorId: mocks.getDefaultActorId,
  logAudit: mocks.logAudit,
}));
vi.mock('@/lib/external-operations', () => ({
  enqueueJiraCommentOperations: vi.fn(),
  enqueueJiraCreateOperation: vi.fn(),
  processExternalOperation: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { linkExistingJiraIssue } from '@/lib/jira-sync';

describe('linkExistingJiraIssue ownership integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getDefaultActorId.mockResolvedValue('system');
    mocks.getJiraIssue.mockResolvedValue({
      id: 'jira-123',
      key: 'OPS-123',
      url: 'https://acme.atlassian.net/browse/OPS-123',
      status: 'To Do',
    });
    mocks.tx.externalIssueLink.findFirst.mockResolvedValue(null);
    mocks.tx.externalIssueLink.create.mockResolvedValue({ id: 'link-1' });
    mocks.transaction.mockImplementation(async callback => callback(mocks.tx));
  });

  it('requires exactly one OpsKnight owner', async () => {
    await expect(
      linkExistingJiraIssue({ projectKey: undefined, jiraKey: 'OPS-123' })
    ).rejects.toThrow('exactly one OpsKnight entity');

    await expect(
      linkExistingJiraIssue({
        incidentId: 'inc-1',
        actionItemId: 'action-1',
        jiraKey: 'OPS-123',
      })
    ).rejects.toThrow('exactly one OpsKnight entity');

    expect(mocks.getJiraIssue).not.toHaveBeenCalled();
  });

  it('locks and rechecks the canonical Jira key before create-only persistence', async () => {
    const result = await linkExistingJiraIssue({ actionItemId: 'action-1', jiraKey: 'ops-123' });

    expect(result.link).toEqual({ id: 'link-1' });
    expect(mocks.acquireJiraExternalIssueLinkFence).toHaveBeenCalledWith(
      mocks.tx,
      'JIRA',
      'OPS-123'
    );
    expect(mocks.tx.externalIssueLink.findFirst).toHaveBeenCalledWith({
      where: {
        provider: 'JIRA',
        OR: [{ externalKey: 'OPS-123' }, { externalId: 'jira-123' }],
      },
      select: { externalKey: true },
    });
    expect(mocks.tx.externalIssueLink.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        provider: 'JIRA',
        incidentId: null,
        actionItemId: 'action-1',
        externalKey: 'OPS-123',
      }),
    });
  });

  it('refuses a key that another owner inserted before the locked recheck', async () => {
    mocks.tx.externalIssueLink.findFirst.mockResolvedValue({ externalKey: 'OPS-123' });

    await expect(
      linkExistingJiraIssue({ incidentId: 'inc-2', jiraKey: 'OPS-123' })
    ).rejects.toThrow('already linked');

    expect(mocks.tx.externalIssueLink.create).not.toHaveBeenCalled();
  });
});
