import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { RunbookArchivedError, RunbookError } from '@/lib/runbooks/errors';
import { retireRunbookVersion } from '@/lib/runbooks/versioning';

vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

type VersionRow = {
  id: string;
  runbookId: string;
  version: number;
  state: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  checksum: string;
  runbookAsPublished: { id: string } | null;
};

function setup(version: VersionRow, options: { pinnedRules?: number; archived?: boolean } = {}) {
  const tx = {
    $queryRaw: vi
      .fn()
      .mockResolvedValue([
        { id: version.runbookId, archivedAt: options.archived ? new Date() : null },
      ]),
    runbook: { findUnique: vi.fn() },
    runbookVersion: {
      findUnique: vi.fn().mockResolvedValue({ runbookId: version.runbookId }),
      findUniqueOrThrow: vi.fn().mockResolvedValue(version),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    serviceAutomationRule: { count: vi.fn().mockResolvedValue(options.pinnedRules ?? 0) },
  };
  vi.mocked(prisma.$transaction).mockImplementation(((callback: (client: typeof tx) => unknown) =>
    callback(tx)) as unknown as typeof prisma.$transaction);
  return tx;
}

const superseded: VersionRow = {
  id: 'ver_old',
  runbookId: 'rb_1',
  version: 2,
  state: 'PUBLISHED',
  checksum: 'a'.repeat(64),
  runbookAsPublished: null,
};

describe('retireRunbookVersion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('retires a superseded published version and audits it', async () => {
    const tx = setup(superseded);
    await expect(retireRunbookVersion('ver_old', 'user_1')).resolves.toEqual({
      id: 'ver_old',
      runbookId: 'rb_1',
      version: 2,
    });
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.serviceAutomationRule.count).toHaveBeenCalledWith({
      where: { runbookVersionId: 'ver_old', versionStrategy: 'PINNED', detachedAt: null },
    });
    expect(tx.runbookVersion.updateMany).toHaveBeenCalledWith({
      where: { id: 'ver_old', state: 'PUBLISHED' },
      data: { state: 'RETIRED' },
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'runbook.version_retired',
        entityType: 'RUNBOOK_VERSION',
        entityId: 'ver_old',
        actorId: 'user_1',
      }),
      tx
    );
  });

  it('refuses the current published version', async () => {
    const tx = setup({ ...superseded, runbookAsPublished: { id: 'rb_1' } });
    await expect(retireRunbookVersion('ver_old', 'user_1')).rejects.toThrow(
      /current published version/
    );
    expect(tx.runbookVersion.updateMany).not.toHaveBeenCalled();
  });

  it('refuses drafts and already retired versions', async () => {
    setup({ ...superseded, state: 'DRAFT' });
    await expect(retireRunbookVersion('ver_old', 'user_1')).rejects.toThrow(/Drafts cannot/);
    setup({ ...superseded, state: 'RETIRED' });
    await expect(retireRunbookVersion('ver_old', 'user_1')).rejects.toThrow(/already retired/);
  });

  it('refuses versions pinned by active automation rules with a user-facing error', async () => {
    const tx = setup(superseded, { pinnedRules: 2 });
    const error = await retireRunbookVersion('ver_old', 'user_1').catch(err => err);
    expect(error).toBeInstanceOf(RunbookError);
    expect((error as RunbookError).userMessage).toMatch(/pinned by 2 automation rules/);
    expect(tx.runbookVersion.updateMany).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('refuses versions of archived runbooks', async () => {
    setup(superseded, { archived: true });
    await expect(retireRunbookVersion('ver_old', 'user_1')).rejects.toBeInstanceOf(
      RunbookArchivedError
    );
  });
});
