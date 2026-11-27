import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));

import { cloneVersionToDraft } from '@/lib/runbooks/versioning';

const tx = {
  runbook: { findUnique: vi.fn(), update: vi.fn() },
  runbookVersion: { findUnique: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
  auditLog: { findMany: vi.fn() },
};

const draft = { id: 'draft-v6', version: 6, state: 'DRAFT' };

function sourceVersion(id: string, version: number) {
  return {
    id,
    version,
    runbookId: 'rb-1',
    definition: {},
    schemaVersion: 1,
    checksum: 'sum',
    inputs: [],
    runbook: { id: 'rb-1', archivedAt: null, draftVersionId: draft.id },
  };
}

function clone(sourceId: string) {
  return cloneVersionToDraft(sourceId, 'user-1', tx as unknown as Prisma.TransactionClient);
}

describe('cloning a version while the runbook already has a draft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.runbook.findUnique.mockResolvedValue({ id: 'rb-1', archivedAt: null });
    tx.runbookVersion.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === draft.id ? draft : sourceVersion(where.id, where.id === 'v5' ? 5 : 2)
    );
  });

  it('returns the draft when the same source made it, so a repeated request is safe', async () => {
    tx.auditLog.findMany.mockResolvedValue([{ details: { sourceVersionId: 'v5', version: 6 } }]);

    await expect(clone('v5')).resolves.toBe(draft);

    expect(tx.runbookVersion.create).not.toHaveBeenCalled();
  });

  it('returns the draft when the source is the draft itself', async () => {
    tx.runbookVersion.findUnique
      .mockResolvedValueOnce(sourceVersion(draft.id, draft.version))
      .mockResolvedValueOnce(draft);

    await expect(clone(draft.id)).resolves.toBe(draft);
  });

  it('refuses a different source and names the existing draft instead of returning it', async () => {
    tx.auditLog.findMany.mockResolvedValue([{ details: { sourceVersionId: 'v5', version: 6 } }]);

    await expect(clone('v2')).rejects.toMatchObject({
      code: 'RESOURCE_CONFLICT',
      userMessage: expect.stringContaining('draft-v6'),
      details: { draftVersionId: 'draft-v6', draftVersion: 6 },
    });

    expect(tx.runbookVersion.create).not.toHaveBeenCalled();
  });

  it('refuses when it cannot tell where the existing draft came from', async () => {
    tx.auditLog.findMany.mockResolvedValue([]);

    await expect(clone('v2')).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT' });
  });
});
