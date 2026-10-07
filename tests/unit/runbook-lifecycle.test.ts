import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Prisma, Runbook } from '@prisma/client';
import {
  buildRunbookLibraryWhere,
  checkRunbookDeleteEligibility,
  deleteRunbook,
  restoreRunbook,
  ensureUniqueSlug,
  duplicateRunbook,
} from '@/lib/runbooks/lifecycle';
import {
  RunbookArchivedError,
  RunbookCannotDeleteError,
  RunbookDefinitionError,
  RunbookNotFoundError,
} from '@/lib/runbooks/errors';
import {
  updateRunbookMetadata,
  updateDraftVersion,
  publishDraftVersion,
  cloneVersionToDraft,
} from '@/lib/runbooks/versioning';
import prisma from '@/lib/prisma';

type MockTx = {
  runbook: {
    findUnique: ReturnType<typeof vi.fn>;
    findUniqueOrThrow?: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    create?: ReturnType<typeof vi.fn>;
  };
  runbookVersion: {
    findUnique?: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    create?: ReturnType<typeof vi.fn>;
  };
  serviceRunbookBinding: {
    updateMany: ReturnType<typeof vi.fn>;
  };
};

vi.mock('@/lib/prisma', () => ({
  default: {
    runbook: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
    },
    runbookVersion: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    serviceRunbookBinding: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn((callback: (tx: MockTx) => Promise<unknown>) =>
      callback({
        runbook: {
          findUnique: vi.fn(),
          update: vi.fn().mockResolvedValue({ id: 'rb_1', archivedAt: null }),
          delete: vi.fn().mockResolvedValue({ id: 'rb_1' }),
          create: vi.fn().mockResolvedValue({ id: 'rb_dup_1', name: 'Original Workflow (Copy)', slug: 'orig-workflow-copy' }),
        },
        runbookVersion: {
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockResolvedValue({ id: 'ver_dup_1', version: 1 }),
        },
        serviceRunbookBinding: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      })
    ),
  },
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

describe('Runbook Lifecycle Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildRunbookLibraryWhere (Query builder)', () => {
    it('defaults to active runbooks (archivedAt: null)', () => {
      const where = buildRunbookLibraryWhere({ page: 1, pageSize: 20 });
      expect(where.archivedAt).toBeNull();
      expect(where.publishedVersionId).toBeUndefined();
      expect(where.draftVersionId).toBeUndefined();
    });

    it('queries archived runbooks when status is "archived"', () => {
      const where = buildRunbookLibraryWhere({ status: 'archived', page: 1, pageSize: 20 });
      expect(where.archivedAt).toEqual({ not: null });
    });

    it('queries archived runbooks when tab is "archived"', () => {
      const where = buildRunbookLibraryWhere({ tab: 'archived', page: 1, pageSize: 20 });
      expect(where.archivedAt).toEqual({ not: null });
    });

    it('filters for published runbooks when status is "published"', () => {
      const where = buildRunbookLibraryWhere({ status: 'published', page: 1, pageSize: 20 });
      expect(where.archivedAt).toBeNull();
      expect(where.publishedVersionId).toEqual({ not: null });
    });

    it('filters for published runbooks when tab is "published"', () => {
      const where = buildRunbookLibraryWhere({ tab: 'published', page: 1, pageSize: 20 });
      expect(where.archivedAt).toBeNull();
      expect(where.publishedVersionId).toEqual({ not: null });
    });

    it('filters for draft runbooks when status is "draft"', () => {
      const where = buildRunbookLibraryWhere({ status: 'draft', page: 1, pageSize: 20 });
      expect(where.archivedAt).toBeNull();
      expect(where.draftVersionId).toEqual({ not: null });
    });

    it('filters for draft runbooks when tab is "drafts"', () => {
      const where = buildRunbookLibraryWhere({ tab: 'drafts', page: 1, pageSize: 20 });
      expect(where.archivedAt).toBeNull();
      expect(where.draftVersionId).toEqual({ not: null });
    });

    it('gives tab precedence over conflicting status dropdown', () => {
      // tab=archived with status=published shows archived runbooks that had a published version
      const archivedPublished = buildRunbookLibraryWhere({
        tab: 'archived',
        status: 'published',
        page: 1,
        pageSize: 20,
      });
      expect(archivedPublished.archivedAt).toEqual({ not: null });
      expect(archivedPublished.publishedVersionId).toEqual({ not: null });

      // tab=published with status=archived keeps active scope because tab takes primary precedence
      const publishedArchived = buildRunbookLibraryWhere({
        tab: 'published',
        status: 'archived',
        page: 1,
        pageSize: 20,
      });
      expect(publishedArchived.archivedAt).toBeNull();
      expect(publishedArchived.publishedVersionId).toEqual({ not: null });
    });

    it('builds search query across name, description, and slug', () => {
      const where = buildRunbookLibraryWhere({ q: 'recovery', page: 1, pageSize: 20 });
      expect(where.OR).toEqual([
        { name: { contains: 'recovery', mode: 'insensitive' } },
        { description: { contains: 'recovery', mode: 'insensitive' } },
        { slug: { contains: 'recovery', mode: 'insensitive' } },
      ]);
    });

    it('builds owner and service filters', () => {
      const where = buildRunbookLibraryWhere({
        ownerId: 'user_123',
        serviceId: 'srv_456',
        page: 1,
        pageSize: 20,
      });
      expect(where.createdById).toBe('user_123');
      expect(where.bindings).toEqual({ some: { serviceId: 'srv_456' } });
    });
  });

  describe('checkRunbookDeleteEligibility', () => {
    it('throws RunbookNotFoundError if runbook does not exist', async () => {
      vi.mocked(prisma.runbook.findUnique).mockResolvedValueOnce(null);
      await expect(checkRunbookDeleteEligibility('non_existent')).rejects.toThrow(
        RunbookNotFoundError
      );
    });

    it('rejects deletion if runbook has execution history', async () => {
      vi.mocked(prisma.runbook.findUnique).mockResolvedValueOnce({
        id: 'rb_1',
        publishedVersionId: null,
        _count: { executions: 5, bindings: 0 },
        versions: [],
      } as unknown as Runbook);

      const result = await checkRunbookDeleteEligibility('rb_1');
      expect(result.canDelete).toBe(false);
      expect(result.hasExecutions).toBe(true);
      expect(result.executionCount).toBe(5);
      expect(result.reason).toContain('execution history');
      expect(result.reason).toContain('Archive the runbook instead');
    });

    it('rejects deletion if runbook has service bindings', async () => {
      vi.mocked(prisma.runbook.findUnique).mockResolvedValueOnce({
        id: 'rb_1',
        publishedVersionId: null,
        _count: { executions: 0, bindings: 2 },
        versions: [],
      } as unknown as Runbook);

      const result = await checkRunbookDeleteEligibility('rb_1');
      expect(result.canDelete).toBe(false);
      expect(result.hasBindings).toBe(true);
      expect(result.bindingCount).toBe(2);
      expect(result.reason).toContain('attached to services');
    });

    it('rejects deletion if runbook has published version history', async () => {
      vi.mocked(prisma.runbook.findUnique).mockResolvedValueOnce({
        id: 'rb_1',
        publishedVersionId: 'ver_pub_1',
        _count: { executions: 0, bindings: 0 },
        versions: [{ id: 'ver_pub_1', version: 1 }],
      } as unknown as Runbook);

      const result = await checkRunbookDeleteEligibility('rb_1');
      expect(result.canDelete).toBe(false);
      expect(result.hasPublishedVersions).toBe(true);
      expect(result.publishedVersionCount).toBe(1);
      expect(result.reason).toContain('published versions');
      expect(result.reason).toContain('Archive the runbook instead');
    });

    it('does not double count publishedVersionId when version is in versions list', async () => {
      vi.mocked(prisma.runbook.findUnique).mockResolvedValueOnce({
        id: 'rb_1',
        publishedVersionId: 'ver_pub_1',
        _count: { executions: 0, bindings: 0 },
        versions: [{ id: 'ver_pub_1', version: 1 }],
      } as unknown as Runbook);

      const result = await checkRunbookDeleteEligibility('rb_1');
      expect(result.publishedVersionCount).toBe(1);
    });

    it('permits deletion for never-published draft with 0 executions and 0 bindings', async () => {
      vi.mocked(prisma.runbook.findUnique).mockResolvedValueOnce({
        id: 'rb_1',
        publishedVersionId: null,
        _count: { executions: 0, bindings: 0 },
        versions: [],
      } as unknown as Runbook);

      const result = await checkRunbookDeleteEligibility('rb_1');
      expect(result.canDelete).toBe(true);
      expect(result.hasExecutions).toBe(false);
      expect(result.hasBindings).toBe(false);
      expect(result.hasPublishedVersions).toBe(false);
      expect(result.reason).toBeUndefined();
    });
  });

  describe('deleteRunbook', () => {
    it('requires non-empty confirmation text', async () => {
      await expect(deleteRunbook('rb_1', 'user_1', '')).rejects.toThrow(
        RunbookCannotDeleteError
      );
    });

    it('throws RunbookCannotDeleteError if runbook is not eligible', async () => {
      vi.mocked(prisma.$transaction).mockImplementationOnce(
        (async (callback: (tx: MockTx) => Promise<unknown>) => {
          const tx: MockTx = {
            runbook: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'rb_1',
                name: 'Diagnostics',
                slug: 'diagnostics',
                publishedVersionId: null,
                _count: { executions: 1, bindings: 0 },
                versions: [],
              }),
              update: vi.fn(),
              delete: vi.fn(),
            },
            runbookVersion: { deleteMany: vi.fn() },
            serviceRunbookBinding: { updateMany: vi.fn() },
          };
          return callback(tx);
        }) as never
      );

      await expect(deleteRunbook('rb_1', 'user_1', 'diagnostics')).rejects.toThrow(
        RunbookCannotDeleteError
      );
    });

    it('rejects generic confirmation text like "delete"', async () => {
      vi.mocked(prisma.$transaction).mockImplementationOnce(
        (async (callback: (tx: MockTx) => Promise<unknown>) => {
          const tx: MockTx = {
            runbook: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'rb_1',
                name: 'Draft Diagnostics',
                slug: 'draft-diagnostics',
                publishedVersionId: null,
                _count: { executions: 0, bindings: 0 },
                versions: [],
              }),
              update: vi.fn(),
              delete: vi.fn(),
            },
            runbookVersion: { deleteMany: vi.fn() },
            serviceRunbookBinding: { updateMany: vi.fn() },
          };
          return callback(tx);
        }) as never
      );

      await expect(deleteRunbook('rb_1', 'user_1', 'delete')).rejects.toThrow(
        RunbookCannotDeleteError
      );
    });

    it('rejects confirmation text that does not match name or slug', async () => {
      vi.mocked(prisma.$transaction).mockImplementationOnce(
        (async (callback: (tx: MockTx) => Promise<unknown>) => {
          const tx: MockTx = {
            runbook: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'rb_1',
                name: 'Draft Diagnostics',
                slug: 'draft-diagnostics',
                publishedVersionId: null,
                _count: { executions: 0, bindings: 0 },
                versions: [],
              }),
              update: vi.fn(),
              delete: vi.fn(),
            },
            runbookVersion: { deleteMany: vi.fn() },
            serviceRunbookBinding: { updateMany: vi.fn() },
          };
          return callback(tx);
        }) as never
      );

      await expect(deleteRunbook('rb_1', 'user_1', 'random-name')).rejects.toThrow(
        RunbookCannotDeleteError
      );
    });

    it('successfully deletes an unused draft when confirmation matches slug', async () => {
      vi.mocked(prisma.$transaction).mockImplementationOnce(
        (async (callback: (tx: MockTx) => Promise<unknown>) => {
          const tx: MockTx = {
            runbook: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'rb_1',
                name: 'Draft Diagnostics',
                slug: 'draft-diagnostics',
                publishedVersionId: null,
                _count: { executions: 0, bindings: 0 },
                versions: [],
              }),
              update: vi.fn().mockResolvedValue({ id: 'rb_1' }),
              delete: vi.fn().mockResolvedValue({ id: 'rb_1' }),
            },
            runbookVersion: { deleteMany: vi.fn() },
            serviceRunbookBinding: { updateMany: vi.fn() },
          };
          return callback(tx);
        }) as never
      );

      const result = await deleteRunbook('rb_1', 'user_1', 'draft-diagnostics');
      expect((result as { id: string }).id).toBe('rb_1');
    });

    it('successfully deletes an unused draft when confirmation matches name', async () => {
      vi.mocked(prisma.$transaction).mockImplementationOnce(
        (async (callback: (tx: MockTx) => Promise<unknown>) => {
          const tx: MockTx = {
            runbook: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'rb_1',
                name: 'Draft Diagnostics',
                slug: 'draft-diagnostics',
                publishedVersionId: null,
                _count: { executions: 0, bindings: 0 },
                versions: [],
              }),
              update: vi.fn().mockResolvedValue({ id: 'rb_1' }),
              delete: vi.fn().mockResolvedValue({ id: 'rb_1' }),
            },
            runbookVersion: { deleteMany: vi.fn() },
            serviceRunbookBinding: { updateMany: vi.fn() },
          };
          return callback(tx);
        }) as never
      );

      const result = await deleteRunbook('rb_1', 'user_1', 'Draft Diagnostics');
      expect((result as { id: string }).id).toBe('rb_1');
    });
  });

  describe('restoreRunbook', () => {
    it('is idempotent if runbook is not currently archived', async () => {
      vi.mocked(prisma.runbook.findUnique).mockResolvedValueOnce({
        id: 'rb_1',
        archivedAt: null,
      } as unknown as Runbook);

      const result = await restoreRunbook('rb_1', 'user_1');
      expect(result.archivedAt).toBeNull();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('restores archived runbook and leaves all bindings disabled for safety', async () => {
      vi.mocked(prisma.runbook.findUnique).mockResolvedValueOnce({
        id: 'rb_1',
        archivedAt: new Date(),
      } as unknown as Runbook);

      let txPassed: MockTx | undefined;
      vi.mocked(prisma.$transaction).mockImplementationOnce(
        (async (callback: (tx: MockTx) => Promise<unknown>) => {
          txPassed = {
            runbook: {
              findUnique: vi.fn(),
              update: vi.fn().mockResolvedValue({ id: 'rb_1', archivedAt: null }),
              delete: vi.fn(),
            },
            runbookVersion: {
              deleteMany: vi.fn(),
            },
            serviceRunbookBinding: {
              updateMany: vi.fn().mockResolvedValue({ count: 2 }),
            },
          };
          return callback(txPassed);
        }) as never
      );

      const result = await restoreRunbook('rb_1', 'user_1');
      expect(result.archivedAt).toBeNull();

      // Invariant: All bindings must be explicitly set to enabled: false upon restore
      expect(txPassed?.serviceRunbookBinding.updateMany).toHaveBeenCalledWith({
        where: {
          runbookId: 'rb_1',
        },
        data: { enabled: false },
      });
    });
  });

  describe('ensureUniqueSlug', () => {
    it('returns base slug if not taken', async () => {
      vi.mocked(prisma.runbook.findUnique).mockResolvedValueOnce(null);
      const slug = await ensureUniqueSlug('my-workflow');
      expect(slug).toBe('my-workflow');
    });

    it('suffixes incrementing counter if collision occurs', async () => {
      vi.mocked(prisma.runbook.findUnique)
        .mockResolvedValueOnce({ id: 'existing_1' } as unknown as Runbook)
        .mockResolvedValueOnce({ id: 'existing_2' } as unknown as Runbook)
        .mockResolvedValueOnce(null);

      const slug = await ensureUniqueSlug('my-workflow');
      expect(slug).toBe('my-workflow-2');
    });
  });

  describe('duplicateRunbook', () => {
    it('creates a cloned runbook with copy suffix and definition', async () => {
      const mockSource = {
        id: 'rb_orig',
        name: 'Original Workflow',
        slug: 'orig-workflow',
        description: 'Original description',
        draftVersion: {
          definition: {
            steps: [{ key: 'step_1', name: 'First Step', type: 'MANUAL', riskClass: 'READ_ONLY' }],
          } as unknown as Prisma.JsonValue,
          inputs: [{ key: 'env', label: 'Env', type: 'STRING', required: true, sequence: 0 }],
        },
        publishedVersion: null,
      } as unknown as Runbook;

      vi.mocked(prisma.runbook.findUnique)
        .mockResolvedValueOnce(mockSource)
        .mockResolvedValueOnce(null); // for ensureUniqueSlug

      const duplicated = await duplicateRunbook('rb_orig', 'user_1');
      expect(duplicated.id).toBe('rb_dup_1');
    });

    it('throws RunbookDefinitionError if source runbook has no versions', async () => {
      const mockEmptySource = {
        id: 'rb_empty',
        name: 'Empty Workflow',
        slug: 'empty-workflow',
        description: 'No versions',
        draftVersion: null,
        publishedVersion: null,
      } as unknown as Runbook;

      vi.mocked(prisma.runbook.findUnique).mockResolvedValueOnce(mockEmptySource);

      await expect(duplicateRunbook('rb_empty', 'user_1')).rejects.toThrow(
        RunbookDefinitionError
      );
    });
  });

  describe('Archived authoring mutation guards', () => {
    it('rejects updateRunbookMetadata on archived runbooks', async () => {
      vi.mocked(prisma.$transaction).mockImplementationOnce(
        (async (callback: (tx: MockTx) => Promise<unknown>) => {
          const tx: MockTx = {
            runbook: {
              findUniqueOrThrow: vi.fn().mockResolvedValue({
                id: 'rb_archived',
                archivedAt: new Date(),
              }),
              findUnique: vi.fn(),
              update: vi.fn(),
              delete: vi.fn(),
            },
            runbookVersion: { deleteMany: vi.fn() },
            serviceRunbookBinding: { updateMany: vi.fn() },
          };
          return callback(tx);
        }) as never
      );

      await expect(
        updateRunbookMetadata('rb_archived', { name: 'New Name' }, 'user_1')
      ).rejects.toThrow(RunbookArchivedError);
    });

    it('rejects updateDraftVersion on archived runbooks', async () => {
      vi.mocked(prisma.$transaction).mockImplementationOnce(
        (async (callback: (tx: MockTx) => Promise<unknown>) => {
          const tx: MockTx = {
            runbook: {
              findUnique: vi.fn(),
              update: vi.fn(),
              delete: vi.fn(),
            },
            runbookVersion: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'ver_1',
                runbookId: 'rb_archived',
                state: 'DRAFT',
                runbook: { archivedAt: new Date() },
              }),
              deleteMany: vi.fn(),
            },
            serviceRunbookBinding: { updateMany: vi.fn() },
          };
          return callback(tx);
        }) as never
      );

      await expect(
        updateDraftVersion(
          'ver_1',
          {
            definition: {
              description: '',
              steps: [{ key: 'step_1', name: 'Step 1', type: 'MANUAL', riskClass: 'READ_ONLY' }],
            },
          },
          'user_1'
        )
      ).rejects.toThrow(RunbookArchivedError);
    });

    it('rejects publishDraftVersion on archived runbooks', async () => {
      vi.mocked(prisma.$transaction).mockImplementationOnce(
        (async (callback: (tx: MockTx) => Promise<unknown>) => {
          const tx: MockTx = {
            runbook: {
              findUnique: vi.fn(),
              update: vi.fn(),
              delete: vi.fn(),
            },
            runbookVersion: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'ver_1',
                runbookId: 'rb_archived',
                state: 'DRAFT',
                runbook: { id: 'rb_archived', archivedAt: new Date() },
                inputs: [],
              }),
              deleteMany: vi.fn(),
            },
            serviceRunbookBinding: { updateMany: vi.fn() },
          };
          return callback(tx);
        }) as never
      );

      await expect(publishDraftVersion('ver_1', 'user_1')).rejects.toThrow(
        RunbookArchivedError
      );
    });

    it('rejects cloneVersionToDraft on archived runbooks', async () => {
      vi.mocked(prisma.$transaction).mockImplementationOnce(
        (async (callback: (tx: MockTx) => Promise<unknown>) => {
          const tx: MockTx = {
            runbook: {
              findUnique: vi.fn(),
              update: vi.fn(),
              delete: vi.fn(),
            },
            runbookVersion: {
              findUnique: vi.fn().mockResolvedValue({
                id: 'ver_1',
                runbookId: 'rb_archived',
                inputs: [],
                runbook: { id: 'rb_archived', archivedAt: new Date() },
              }),
              deleteMany: vi.fn(),
            },
            serviceRunbookBinding: { updateMany: vi.fn() },
          };
          return callback(tx);
        }) as never
      );

      await expect(cloneVersionToDraft('ver_1', 'user_1')).rejects.toThrow(
        RunbookArchivedError
      );
    });
  });
});
