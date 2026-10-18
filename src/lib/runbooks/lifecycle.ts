import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  logRunbookCommandAudit,
  runRunbookCommand,
  type RunbookCommandActor,
  type RunbookCommandClient,
} from './command-context';
import { createRunbook } from './versioning';
import { lockRunbookForUpdate } from './locking';
import { RunbookCannotDeleteError, RunbookDefinitionError, RunbookNotFoundError } from './errors';

export { RunbookCannotDeleteError, RunbookDefinitionError, RunbookNotFoundError };
import { type RunbookLibraryFilter } from './schemas';

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
  runbookId: string,
  client: RunbookCommandClient = prisma
): Promise<RunbookDeleteEligibility> {
  const runbook = await client.runbook.findUnique({
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
          OR: [{ state: { in: ['PUBLISHED', 'RETIRED'] } }, { publishedAt: { not: null } }],
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
      reason: 'Cannot delete: Runbook is attached to services. Remove all service bindings first.',
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
  actor: RunbookCommandActor,
  confirmationText: string,
  client?: RunbookCommandClient
) {
  const actorId = typeof actor === 'string' ? actor : actor.id;
  const trimmedConfirmation = (confirmationText ?? '').trim();
  if (!trimmedConfirmation) {
    throw new RunbookCannotDeleteError(
      'Typed confirmation matching the Runbook name or slug is required for permanent deletion.'
    );
  }

  return runRunbookCommand(client, async tx => {
    await lockRunbookForUpdate(tx, runbookId, { allowArchived: true, action: 'delete' });
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
            OR: [{ state: { in: ['PUBLISHED', 'RETIRED'] } }, { publishedAt: { not: null } }],
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

    await logRunbookCommandAudit(
      actor,
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
  });
}

/**
 * Restores an archived runbook back to usable state.
 * Safety rule: All service bindings remain disabled (`enabled: false`) upon restore,
 * requiring explicit operator review and activation to prevent unintended automated actions.
 */
export async function restoreRunbook(
  runbookId: string,
  actor: RunbookCommandActor,
  client?: RunbookCommandClient
) {
  const actorId = typeof actor === 'string' ? actor : actor.id;
  return runRunbookCommand(client, async tx => {
    await lockRunbookForUpdate(tx, runbookId, { allowArchived: true, action: 'restore' });
    const current = await tx.runbook.findUnique({
      where: { id: runbookId },
    });

    if (!current) {
      throw new RunbookNotFoundError(runbookId);
    }

    if (!current.archivedAt) {
      return current;
    }

    const restored = await tx.runbook.update({
      where: { id: runbookId },
      data: { archivedAt: null },
    });

    // Safety rule: All service bindings are explicitly kept disabled upon restoration.
    // An operator must intentionally review and re-enable each binding.
    await tx.serviceAutomationRule.updateMany({
      where: { runbookId },
      data: { enabled: false },
    });

    await logRunbookCommandAudit(
      actor,
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
export async function ensureUniqueSlug(
  baseSlug: string,
  client: RunbookCommandClient = prisma
): Promise<string> {
  const normalized =
    baseSlug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 110) || 'runbook';
  for (let counter = 0; counter < 1000; counter++) {
    const slug = counter === 0 ? normalized : `${normalized}-${counter}`;
    if (!(await client.runbook.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
  throw new RunbookDefinitionError(
    'Could not allocate a duplicate slug within the supported search limit.'
  );
}

/** Source locking makes the cloned definition and metadata one coherent revision.
 * The canonical creator preserves input choices/defaults and validates definitions.
 */
export async function duplicateRunbook(
  runbookId: string,
  actor: RunbookCommandActor,
  client?: RunbookCommandClient
) {
  const actorId = typeof actor === 'string' ? actor : actor.id;
  return runRunbookCommand(client, async tx => {
    await lockRunbookForUpdate(tx, runbookId, { allowArchived: true, action: 'duplicate' });
    const source = await tx.runbook.findUnique({
      where: { id: runbookId },
      include: {
        draftVersion: { include: { inputs: { orderBy: { sequence: 'asc' } } } },
        publishedVersion: { include: { inputs: { orderBy: { sequence: 'asc' } } } },
      },
    });
    if (!source) throw new RunbookNotFoundError(runbookId);
    const version = source.draftVersion ?? source.publishedVersion;
    if (!version)
      throw new RunbookDefinitionError(
        'Cannot duplicate a runbook without any version definition.'
      );
    const slug = await ensureUniqueSlug(`${source.slug}-copy`, tx);
    const copy = await createRunbook(
      {
        name: `${source.name.slice(0, 193).trimEnd()} (Copy)`,
        slug,
        description: source.description,
        ownerTeamId: source.ownerTeamId,
        tags: source.tags,
        definition: version.definition,
        inputs: version.inputs.map(input => ({
          key: input.key,
          label: input.label,
          type: input.type,
          required: input.required,
          defaultValue: input.defaultValue ?? undefined,
          description: input.description,
          sequence: input.sequence,
          options: input.options,
        })),
      },
      actor,
      tx
    );
    await logRunbookCommandAudit(
      actor,
      {
        action: 'runbook.duplicated',
        entityType: 'RUNBOOK',
        entityId: copy.id,
        actorId,
        details: { sourceRunbookId: runbookId, slug: copy.slug },
      },
      tx
    );
    return copy;
  });
}

/**
 * Constructs a bounded Prisma where clause for the Runbook Library query.
 * Correctly distinguishes between active and archived views, ensuring archived
 * runbooks remain discoverable via dedicated query/tab params with unambiguous precedence.
 */
export function buildRunbookLibraryWhere(filter: RunbookLibraryFilter): Prisma.RunbookWhereInput {
  // Precedence: tab specifies primary lifecycle scope.
  // 1. If tab is 'archived' OR (no tab specified and status is 'archived'), query strictly archived runbooks.
  // 2. Otherwise query strictly active (non-archived) runbooks.
  const isArchivedView = filter.tab === 'archived' || (!filter.tab && filter.status === 'archived');

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

  // Precedence for status/version filter:
  // Explicit tab takes precedence over status dropdown
  const effectiveStatus =
    filter.tab === 'published' || filter.tab === 'drafts'
      ? filter.tab === 'published'
        ? 'published'
        : 'draft'
      : filter.status;

  if (effectiveStatus === 'published') {
    where.publishedVersionId = { not: null };
  } else if (effectiveStatus === 'draft') {
    where.draftVersionId = { not: null };
  }

  if (filter.ownerId) {
    where.createdById = filter.ownerId;
  }

  if (filter.teamId) {
    where.ownerTeamId = filter.teamId;
  }

  if (filter.tag) {
    where.tags = { has: filter.tag };
  }

  if (filter.serviceId) {
    where.bindings = { some: { serviceId: filter.serviceId } };
  }

  return where;
}
