import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import {
  RunbookCannotDeleteError,
  RunbookNotFoundError,
  RunbookRestoreError,
} from './errors';
import { createRunbook } from './versioning';
import type { RunbookInputInput, RunbookLibraryFilter } from './schemas';

export type RunbookDeleteEligibility = {
  canDelete: boolean;
  reason?: string;
  hasExecutions: boolean;
  hasBindings: boolean;
  hasPublishedVersions: boolean;
  executionCount: number;
  bindingCount: number;
  publishedVersionCount: number;
};

/**
 * Enterprise lifecycle safe-delete evaluation:
 * - A never-published draft with ZERO executions and ZERO bindings can be safely deleted.
 * - Any runbook with execution/audit history MUST NOT be deleted (destroys incident evidence).
 * - Any runbook with active service bindings MUST NOT be deleted.
 * - Any runbook with published or retired version history MUST NOT be hard-deleted (archive instead).
 */
export async function checkRunbookDeleteEligibility(
  runbookId: string
): Promise<RunbookDeleteEligibility> {
  const runbook = await prisma.runbook.findUnique({
    where: { id: runbookId },
    include: {
      _count: {
        select: {
          executions: true,
          bindings: true,
        },
      },
      versions: {
        where: {
          OR: [
            { state: { in: ['PUBLISHED', 'RETIRED'] } },
            { publishedAt: { not: null } },
          ],
        },
        select: { id: true, version: true },
      },
    },
  });

  if (!runbook) {
    throw new RunbookNotFoundError(runbookId);
  }

  const executionCount = runbook._count.executions;
  const bindingCount = runbook._count.bindings;
  const publishedVersionIds = new Set(runbook.versions.map(v => v.id));
  if (runbook.publishedVersionId) {
    publishedVersionIds.add(runbook.publishedVersionId);
  }
  const publishedVersionCount = publishedVersionIds.size;

  const hasExecutions = executionCount > 0;
  const hasBindings = bindingCount > 0;
  const hasPublishedVersions = publishedVersionCount > 0;

  if (hasExecutions) {
    return {
      canDelete: false,
      reason:
        'Cannot delete: Runbook has execution history. Archive the runbook instead to preserve incident response evidence.',
      hasExecutions,
      hasBindings,
      hasPublishedVersions,
      executionCount,
      bindingCount,
      publishedVersionCount,
    };
  }

  if (hasBindings) {
    return {
      canDelete: false,
      reason:
        'Cannot delete: Runbook is attached to services. Remove all service bindings first.',
      hasExecutions,
      hasBindings,
      hasPublishedVersions,
      executionCount,
      bindingCount,
      publishedVersionCount,
    };
  }

  if (hasPublishedVersions) {
    return {
      canDelete: false,
      reason:
        'Cannot delete: Runbook has published versions. Only never-published drafts with zero executions and zero bindings can be permanently deleted. Archive the runbook instead.',
      hasExecutions,
      hasBindings,
      hasPublishedVersions,
      executionCount,
      bindingCount,
      publishedVersionCount,
    };
  }

  return {
    canDelete: true,
    hasExecutions: false,
    hasBindings: false,
    hasPublishedVersions: false,
    executionCount: 0,
    bindingCount: 0,
    publishedVersionCount: 0,
  };
}

/**
 * Permanently deletes an unused runbook draft.
 * Invariants:
 * - Typed confirmation matching the exact Runbook name or slug is MANDATORY.
 * - Re-checks all eligibility conditions inside the same serializable transaction
 *   to eliminate any race condition where a draft could be published or bound concurrently.
 */
export async function deleteRunbook(
  runbookId: string,
  actorId: string,
  confirmationText: string
) {
  const trimmedConfirmation = (confirmationText ?? '').trim();
  if (!trimmedConfirmation) {
    throw new RunbookCannotDeleteError(
      'Typed confirmation matching the Runbook name or slug is required for permanent deletion.'
    );
  }

  return prisma.$transaction(
    async tx => {
      const runbook = await tx.runbook.findUnique({
        where: { id: runbookId },
        include: {
          _count: {
            select: {
              executions: true,
              bindings: true,
            },
          },
          versions: {
            where: {
              OR: [
                { state: { in: ['PUBLISHED', 'RETIRED'] } },
                { publishedAt: { not: null } },
              ],
            },
            select: { id: true },
          },
        },
      });

      if (!runbook) {
        throw new RunbookNotFoundError(runbookId);
      }

      const matchesName = trimmedConfirmation === runbook.name.trim();
      const matchesSlug = trimmedConfirmation === runbook.slug.trim();
      if (!matchesName && !matchesSlug) {
        throw new RunbookCannotDeleteError(
          `Confirmation text "${confirmationText}" did not match the Runbook name ("${runbook.name}") or slug ("${runbook.slug}").`
        );
      }

      const executionCount = runbook._count.executions;
      const bindingCount = runbook._count.bindings;
      const publishedVersionIds = new Set(runbook.versions.map(v => v.id));
      if (runbook.publishedVersionId) {
        publishedVersionIds.add(runbook.publishedVersionId);
      }

      if (executionCount > 0) {
        throw new RunbookCannotDeleteError(
          'Cannot delete: Runbook has execution history. Archive the runbook instead to preserve incident response evidence.'
        );
      }
      if (bindingCount > 0) {
        throw new RunbookCannotDeleteError(
          'Cannot delete: Runbook is attached to services. Remove all service bindings first.'
        );
      }
      if (publishedVersionIds.size > 0) {
        throw new RunbookCannotDeleteError(
          'Cannot delete: Runbook has published versions. Only never-published drafts with zero executions and zero bindings can be permanently deleted. Archive the runbook instead.'
        );
      }

      // Break cyclic self-referencing foreign keys on Runbook before deleting
      await tx.runbook.update({
        where: { id: runbookId },
        data: { draftVersionId: null, publishedVersionId: null },
      });

      // Clean up draft versions and inputs
      await tx.runbookVersion.deleteMany({
        where: { runbookId },
      });

      // Delete the runbook entity
      const deleted = await tx.runbook.delete({
        where: { id: runbookId },
      });

      await logAudit(
        {
          action: 'runbook.deleted',
          entityType: 'RUNBOOK',
          entityId: runbookId,
          actorId,
          oldValue: { name: runbook.name, slug: runbook.slug, deletedAt: new Date().toISOString() },
        },
        tx
      );

      return deleted;
    },
    { isolationLevel: 'Serializable' }
  );
}

/**
 * Restores an archived runbook back to usable state.
 * Safety rule: All service bindings remain disabled (`enabled: false`) upon restore,
 * requiring explicit operator review and activation to prevent unintended automated actions.
 */
export async function restoreRunbook(runbookId: string, actorId: string) {
  const runbook = await prisma.runbook.findUnique({
    where: { id: runbookId },
  });

  if (!runbook) {
    throw new RunbookNotFoundError(runbookId);
  }

  if (!runbook.archivedAt) {
    return runbook; // Idempotent restore
  }

  return prisma.$transaction(async tx => {
    const restored = await tx.runbook.update({
      where: { id: runbookId },
      data: { archivedAt: null },
    });

    // Safety rule: All service bindings are explicitly kept disabled upon restoration.
    // An operator must intentionally review and re-enable each binding.
    await tx.serviceRunbookBinding.updateMany({
      where: { runbookId },
      data: { enabled: false },
    });

    await logAudit(
      {
        action: 'runbook.restored',
        entityType: 'RUNBOOK',
        entityId: runbookId,
        actorId,
        newValue: {
          archivedAt: null,
          bindingsKeptDisabled: true,
        },
      },
      tx
    );

    return restored;
  });
}

/**
 * Generates a collision-free slug by suffixing incrementing integers when necessary.
 */
export async function ensureUniqueSlug(baseSlug: string): Promise<string> {
  const normalized = baseSlug
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 110) || 'runbook';

  let slug = normalized;
  let counter = 1;

  while (await prisma.runbook.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${normalized}-${counter++}`;
  }

  return slug;
}

/**
 * Clones an existing runbook into a new independent draft runbook.
 */
export async function duplicateRunbook(runbookId: string, actorId: string) {
  const source = await prisma.runbook.findUnique({
    where: { id: runbookId },
    include: {
      draftVersion: {
        include: { inputs: { orderBy: { sequence: 'asc' } } },
      },
      publishedVersion: {
        include: { inputs: { orderBy: { sequence: 'asc' } } },
      },
    },
  });

  if (!source) {
    throw new RunbookNotFoundError(runbookId);
  }

  const activeVersion = source.draftVersion || source.publishedVersion;
  if (!activeVersion) {
    throw new RunbookRestoreError('Cannot duplicate a runbook without any version definition.');
  }

  const uniqueSlug = await ensureUniqueSlug(`${source.slug}-copy`);
  const name = `${source.name} (Copy)`;

  const duplicated = await createRunbook(
    {
      name,
      slug: uniqueSlug,
      description: source.description,
      definition: activeVersion.definition,
      inputs: activeVersion.inputs.map(input => ({
        key: input.key,
        label: input.label,
        type: input.type as unknown as RunbookInputInput['type'],
        required: input.required,
        defaultValue: input.defaultValue ?? undefined,
        description: input.description,
        sequence: input.sequence,
      })),
    },
    actorId
  );

  await logAudit({
    action: 'runbook.duplicated',
    entityType: 'RUNBOOK',
    entityId: duplicated.id,
    actorId,
    details: { sourceRunbookId: runbookId, slug: uniqueSlug },
  });

  return duplicated;
}

/**
 * Constructs a bounded Prisma where clause for the Runbook Library query.
 * Correctly distinguishes between active and archived views, ensuring archived
 * runbooks remain discoverable via dedicated query/tab params.
 */
export function buildRunbookLibraryWhere(
  filter: RunbookLibraryFilter
): Prisma.RunbookWhereInput {
  const isArchivedView = filter.tab === 'archived' || filter.status === 'archived';
  const isPublishedFilter = filter.tab === 'published' || filter.status === 'published';
  const isDraftFilter = filter.tab === 'drafts' || filter.status === 'draft';

  const where: Prisma.RunbookWhereInput = {
    archivedAt: isArchivedView ? { not: null } : null,
  };

  if (filter.q) {
    where.OR = [
      { name: { contains: filter.q, mode: 'insensitive' } },
      { description: { contains: filter.q, mode: 'insensitive' } },
      { slug: { contains: filter.q, mode: 'insensitive' } },
    ];
  }

  if (isPublishedFilter) {
    where.publishedVersionId = { not: null };
  } else if (isDraftFilter) {
    where.draftVersionId = { not: null };
  }

  if (filter.ownerId) {
    where.createdById = filter.ownerId;
  }

  if (filter.serviceId) {
    where.bindings = { some: { serviceId: filter.serviceId } };
  }

  return where;
}
