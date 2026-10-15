// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { deleteOidcRevision, cleanupStagedRevisions } from '@/lib/auth-control/oidc-revisions';
import type { ControlActor } from '@/lib/auth-control/actor';

vi.mock('@/lib/auth-control/actor', () => ({
  lockControlActor: vi.fn().mockResolvedValue(undefined),
  FRESH_AUTHENTICATION_MAX_AGE_MS: 7200000,
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

describe('OIDC revision deletion and cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects deleting the currently active revision', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async callback => {
      const mockTx = {
        authenticationPolicy: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'default', activeRevisionId: 'rev-active' }),
        },
      } as never;
      return callback(mockTx);
    });

    await expect(deleteOidcRevision(mockActor, 'rev-active')).rejects.toThrow(
      'Cannot delete the currently active provider revision'
    );
  });

  it('rejects deleting a revision that has previously been activated', async () => {
    vi.mocked(prisma.$transaction).mockImplementation(async callback => {
      const mockTx = {
        authenticationPolicy: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'default', activeRevisionId: 'rev-active' }),
        },
        oidcRevision: {
          findUnique: vi.fn().mockResolvedValue({ id: 'rev-prev', activatedAt: new Date() }),
        },
      } as never;
      return callback(mockTx);
    });

    await expect(deleteOidcRevision(mockActor, 'rev-prev')).rejects.toThrow(
      'Cannot delete a revision that has previously been activated'
    );
  });

  it('deletes an unactivated staged candidate revision and its tests', async () => {
    const deleteTestsMock = vi.fn().mockResolvedValue({ count: 1 });
    const deleteRevMock = vi.fn().mockResolvedValue({ id: 'rev-staged-1' });

    vi.mocked(prisma.$transaction).mockImplementation(async callback => {
      const mockTx = {
        authenticationPolicy: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'default', activeRevisionId: 'rev-active' }),
        },
        oidcRevision: {
          findUnique: vi.fn().mockResolvedValue({ id: 'rev-staged-1', activatedAt: null }),
          delete: deleteRevMock,
        },
        oidcRevisionTest: {
          deleteMany: deleteTestsMock,
        },
      } as never;
      return callback(mockTx);
    });

    const result = await deleteOidcRevision(mockActor, 'rev-staged-1');
    expect(result.ok).toBe(true);
    expect(result.deletedRevisionId).toBe('rev-staged-1');
    expect(deleteTestsMock).toHaveBeenCalledWith({ where: { revisionId: 'rev-staged-1' } });
    expect(deleteRevMock).toHaveBeenCalledWith({ where: { id: 'rev-staged-1' } });
  });

  it('cleans up all unactivated staged candidates in bulk', async () => {
    const deleteTestsMock = vi.fn().mockResolvedValue({ count: 2 });
    const deleteRevsMock = vi.fn().mockResolvedValue({ count: 2 });

    vi.mocked(prisma.$transaction).mockImplementation(async callback => {
      const mockTx = {
        authenticationPolicy: {
          findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'default', activeRevisionId: 'rev-active' }),
        },
        oidcRevision: {
          findMany: vi.fn().mockResolvedValue([{ id: 'rev-staged-1' }, { id: 'rev-staged-2' }]),
          deleteMany: deleteRevsMock,
        },
        oidcRevisionTest: {
          deleteMany: deleteTestsMock,
        },
      } as never;
      return callback(mockTx);
    });

    const result = await cleanupStagedRevisions(mockActor);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(deleteTestsMock).toHaveBeenCalledWith({
      where: { revisionId: { in: ['rev-staged-1', 'rev-staged-2'] } },
    });
    expect(deleteRevsMock).toHaveBeenCalledWith({
      where: { id: { in: ['rev-staged-1', 'rev-staged-2'] } },
    });
  });
});
