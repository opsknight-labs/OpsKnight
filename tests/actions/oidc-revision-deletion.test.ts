// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { deleteOidcRevision, cleanupStagedRevisions } from '@/lib/auth-control/oidc-revisions';
import type { ControlActor } from '@/lib/auth-control/actor';
import { securityEvent } from '@/lib/auth-control/security-events';

vi.mock('@/lib/auth-control/actor', () => ({
  lockControlActor: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/auth-control/security-events', () => ({
  securityEvent: vi.fn().mockResolvedValue(undefined),
}));

const mockActor: ControlActor = {
  kind: 'admin',
  id: 'admin-user-1',
  tokenVersion: 1,
  authenticatedAt: Date.now(),
};

type Revision = { id: string; activatedAt: Date | null };

function transaction(revisions: Revision[], activeRevisionId: string | null = 'rev-active') {
  const tx = {
    authenticationPolicy: {
      findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'default', activeRevisionId }),
    },
    oidcRevision: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          revisions.find(revision => revision.id === where.id) ?? null
      ),
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        revisions.filter(revision => where.id.in.includes(revision.id))
      ),
      delete: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => ({
        count: where.id.in.length,
      })),
    },
    oidcRevisionTest: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    oidcTestFlow: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  vi.mocked(prisma.$transaction).mockImplementation(async callback =>
    (callback as unknown as (value: typeof tx) => unknown)(tx)
  );
  return tx;
}

describe('OIDC revision deletion and cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects deleting the currently active revision', async () => {
    transaction([{ id: 'rev-active', activatedAt: new Date() }]);
    await expect(deleteOidcRevision(mockActor, 'rev-active')).rejects.toThrow(
      'The active configuration cannot be deleted.'
    );
  });

  it('rejects deleting a revision that has previously been activated', async () => {
    transaction([{ id: 'rev-prev', activatedAt: new Date() }]);
    await expect(deleteOidcRevision(mockActor, 'rev-prev')).rejects.toThrow(
      'Previously activated configurations are kept as rollback history.'
    );
  });

  it('reports a precise conflict when another session already deleted the draft', async () => {
    transaction([]);
    await expect(deleteOidcRevision(mockActor, 'rev-gone')).rejects.toThrow(
      'already deleted in another session'
    );
  });

  it('deletes a draft, its proofs, and cancels in-flight sign-in tests', async () => {
    const tx = transaction([{ id: 'rev-staged-1', activatedAt: null }]);

    const result = await deleteOidcRevision(mockActor, 'rev-staged-1');

    expect(result).toEqual({ ok: true, deletedRevisionId: 'rev-staged-1' });
    expect(tx.oidcTestFlow.updateMany).toHaveBeenCalledWith({
      where: {
        revisionId: { in: ['rev-staged-1'] },
        consumedAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      data: { expiresAt: expect.any(Date) },
    });
    expect(tx.oidcRevisionTest.deleteMany).toHaveBeenCalledWith({
      where: { revisionId: 'rev-staged-1' },
    });
    expect(tx.oidcRevision.delete).toHaveBeenCalledWith({ where: { id: 'rev-staged-1' } });
    expect(securityEvent).toHaveBeenCalledWith(
      tx,
      'auth.oidc.revision.deleted',
      'admin-user-1',
      expect.objectContaining({ revisionId: 'rev-staged-1', cancelledTests: 1 })
    );
  });

  it('bulk cleanup deletes only the confirmed drafts that are still eligible', async () => {
    const tx = transaction(
      [
        { id: 'rev-staged-1', activatedAt: null },
        { id: 'rev-staged-2', activatedAt: null },
        // Activated by another administrator after the confirmation dialog opened.
        { id: 'rev-now-active', activatedAt: new Date() },
        // A draft created after the dialog opened is not in the confirmed list.
        { id: 'rev-new-draft', activatedAt: null },
      ],
      'rev-now-active'
    );

    const result = await cleanupStagedRevisions(mockActor, [
      'rev-staged-1',
      'rev-staged-2',
      'rev-now-active',
      'rev-deleted-elsewhere',
    ]);

    expect(result).toEqual({
      ok: true,
      count: 2,
      skipped: 2,
      deletedIds: ['rev-staged-1', 'rev-staged-2'],
    });
    expect(tx.oidcRevisionTest.deleteMany).toHaveBeenCalledWith({
      where: { revisionId: { in: ['rev-staged-1', 'rev-staged-2'] } },
    });
    expect(tx.oidcRevision.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['rev-staged-1', 'rev-staged-2'] }, activatedAt: null },
    });
  });

  it('bulk cleanup with nothing confirmed is a no-op', async () => {
    const tx = transaction([{ id: 'rev-staged-1', activatedAt: null }]);
    const result = await cleanupStagedRevisions(mockActor, []);
    expect(result.count).toBe(0);
    expect(tx.oidcRevision.deleteMany).not.toHaveBeenCalled();
  });
});
