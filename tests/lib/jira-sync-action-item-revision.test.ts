import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/jira', () => ({ getJiraIssue: vi.fn() }));
vi.mock('@/lib/external-operations', () => ({
  enqueueJiraCommentOperations: vi.fn(),
  enqueueJiraCreateOperation: vi.fn(),
  processExternalOperation: vi.fn(),
  jiraCommentableIncidentLinksWhere: vi.fn(),
}));
vi.mock('@/lib/jira-concurrency', () => ({ acquireJiraExternalIssueLinkFence: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn(), getDefaultActorId: vi.fn() }));
vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { syncLinkedEntitiesForJiraIssue } from '@/lib/jira-sync';

const tx = {
  actionItem: { updateMany: vi.fn(), findMany: vi.fn() },
  postmortem: { findUnique: vi.fn(), update: vi.fn() },
};

function sync() {
  return syncLinkedEntitiesForJiraIssue(
    {
      externalKey: 'OPS-1',
      externalStatus: 'Done',
      isDone: true,
      actionItemIds: ['item-1'],
      incidentLinks: [],
    },
    tx as unknown as Prisma.TransactionClient
  );
}

describe('Jira status sync on an action item', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.actionItem.findMany.mockResolvedValue([
      {
        id: 'item-1',
        postmortemId: 'pm-1',
        incidentId: 'inc-1',
        status: 'COMPLETED',
        completedAt: new Date('2026-11-20T10:00:00.000Z'),
      },
    ]);
  });

  it('still changes the parent postmortem when it has no legacy action-item JSON, so If-Match sees it', async () => {
    tx.postmortem.findUnique.mockResolvedValue({ actionItems: null });

    await sync();

    expect(tx.postmortem.update).toHaveBeenCalledWith({
      where: { id: 'pm-1' },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it('mirrors the status into the legacy JSON when there is one', async () => {
    tx.postmortem.findUnique.mockResolvedValue({
      actionItems: [{ id: 'item-1', status: 'OPEN', completedAt: null }],
    });

    await sync();

    expect(tx.postmortem.update).toHaveBeenCalledWith({
      where: { id: 'pm-1' },
      data: {
        actionItems: [
          { id: 'item-1', status: 'COMPLETED', completedAt: '2026-11-20T10:00:00.000Z' },
        ],
      },
    });
  });
});
