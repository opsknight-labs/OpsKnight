import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import {
  RunbookArchivedError,
  RunbookError,
  assertRunbookVersionRunnable,
} from '@/lib/runbooks/errors';
import { retireRunbookVersion, unpublishRunbook } from '@/lib/runbooks/versioning';

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

describe('assertRunbookVersionRunnable', () => {
  it('refuses a retired version, naming it and saying what to do', () => {
    const error = (() => {
      try {
        assertRunbookVersionRunnable({ id: 'ver_old', version: 4, state: 'RETIRED' });
      } catch (caught) {
        return caught as RunbookError;
      }
    })();
    expect(error).toBeInstanceOf(RunbookError);
    expect(error?.userMessage).toMatch(
      /Runbook version 4 is retired and cannot run\. Publish a current version, or pin the rule to a published version\./
    );
  });

  it('lets a published version run', () => {
    expect(() =>
      assertRunbookVersionRunnable({ id: 'ver_new', version: 5, state: 'PUBLISHED' })
    ).not.toThrow();
  });
});

describe('unpublishRunbook', () => {
  function setupUnpublish(published: { id: string; version: number; checksum: string } | null) {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ id: 'rb_1', archivedAt: null }]),
      runbook: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'rb_1', publishedVersion: published }),
        update: vi.fn().mockResolvedValue({}),
      },
      runbookVersion: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    vi.mocked(prisma.$transaction).mockImplementation(((callback: (client: typeof tx) => unknown) =>
      callback(tx)) as unknown as typeof prisma.$transaction);
    return tx;
  }

  beforeEach(() => vi.clearAllMocks());

  it('retires the live version, clears the published pointer and audits it', async () => {
    const tx = setupUnpublish({ id: 'ver_live', version: 3, checksum: 'c'.repeat(64) });
    await expect(unpublishRunbook('rb_1', 'user_1')).resolves.toEqual({ id: 'rb_1', version: 3 });
    expect(tx.runbookVersion.updateMany).toHaveBeenCalledWith({
      where: { id: 'ver_live', state: 'PUBLISHED' },
      data: { state: 'RETIRED' },
    });
    expect(tx.runbook.update).toHaveBeenCalledWith({
      where: { id: 'rb_1' },
      data: { publishedVersionId: null },
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'runbook.unpublished',
        entityType: 'RUNBOOK',
        entityId: 'rb_1',
        actorId: 'user_1',
      }),
      tx
    );
  });

  it('refuses a runbook that has no published version', async () => {
    const tx = setupUnpublish(null);
    await expect(unpublishRunbook('rb_1', 'user_1')).rejects.toThrow(/no published version/);
    expect(tx.runbookVersion.updateMany).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
