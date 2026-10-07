import 'server-only';

import type { Prisma, RunbookInput, RunbookVersion } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { runSerializableTransaction } from '@/lib/db-utils';
import {
  computeDefinitionChecksum,
  parseRunbookDefinition,
  validateInputKeyUniqueness,
} from './definition';
import {
  RunbookDefinitionError,
  RunbookVersionImmutableError,
  RunbookVersionNotFoundError,
} from './errors';
import { lockRunbookForUpdate } from './locking';
import {
  createRunbookSchema,
  runbookInputsSchema,
  updateRunbookSchema,
  type CreateRunbookInput,
  type RunbookInputInput,
  type UpdateRunbookInput,
} from './schemas';
import type { RunbookDefinition } from './types';

const EMPTY_DEFINITION: RunbookDefinition = {
  description: '',
  steps: [
    {
      key: 'first_step',
      name: 'First step',
      description: 'Describe the first operational action.',
      type: 'MANUAL',
      riskClass: 'READ_ONLY',
      config: {},
    },
  ],
};

export type VersioningClient = Prisma.TransactionClient;

export function toInputCreateMany(inputs: RunbookInputInput[]) {
  return inputs.map((input, index) => ({
    key: input.key,
    label: input.label,
    type: input.type,
    required: input.required,
    defaultValue: input.defaultValue,
    description: input.description,
    sequence: input.sequence ?? index,
  }));
}

function definitionJson(definition: RunbookDefinition): Prisma.InputJsonValue {
  return definition as unknown as Prisma.InputJsonValue;
}

export async function createRunbook(
  input: CreateRunbookInput & {
    definition?: unknown;
    inputs?: RunbookInputInput[];
  },
  actorId: string
) {
  const metadata = createRunbookSchema.parse(input);
  const inputs = runbookInputsSchema.parse(input.inputs ?? []);
  const definition = parseRunbookDefinition(input.definition ?? EMPTY_DEFINITION, inputs);
  validateInputKeyUniqueness(inputs);
  const checksum = computeDefinitionChecksum(definition);

  return prisma.$transaction(async tx => {
    const runbook = await tx.runbook.create({
      data: { ...metadata, createdById: actorId },
    });
    const draft = await tx.runbookVersion.create({
      data: {
        runbookId: runbook.id,
        version: 1,
        state: 'DRAFT',
        definition: definitionJson(definition),
        checksum,
        createdById: actorId,
        inputs: inputs.length ? { createMany: { data: toInputCreateMany(inputs) } } : undefined,
      },
      include: { inputs: { orderBy: { sequence: 'asc' } } },
    });
    await tx.runbook.update({
      where: { id: runbook.id },
      data: { draftVersionId: draft.id },
    });
    await logAudit(
      {
        action: 'runbook.created',
        entityType: 'RUNBOOK',
        entityId: runbook.id,
        actorId,
        newValue: { name: runbook.name, slug: runbook.slug, draftVersion: 1 },
      },
      tx
    );
    return { ...runbook, draftVersionId: draft.id, draftVersion: draft };
  });
}

export async function updateRunbookMetadata(
  runbookId: string,
  input: UpdateRunbookInput,
  actorId: string
) {
  const data = updateRunbookSchema.parse(input);
  return prisma.$transaction(async tx => {
    await lockRunbookForUpdate(tx, runbookId, { action: 'update' });
    const current = await tx.runbook.findUniqueOrThrow({ where: { id: runbookId } });
    const updated = await tx.runbook.update({ where: { id: runbookId }, data });
    await logAudit(
      {
        action: 'runbook.updated',
        entityType: 'RUNBOOK',
        entityId: runbookId,
        actorId,
        oldValue: { name: current.name, slug: current.slug, description: current.description },
        newValue: { name: updated.name, slug: updated.slug, description: updated.description },
      },
      tx
    );
    return updated;
  });
}

/** Updates a draft using a state predicate so a concurrent publish cannot be overwritten. */
export async function updateDraftVersion(
  versionId: string,
  input: { definition: unknown; inputs?: RunbookInputInput[] },
  actorId: string
) {
  const inputs = runbookInputsSchema.parse(input.inputs ?? []);
  const definition = parseRunbookDefinition(input.definition, inputs);
  const checksum = computeDefinitionChecksum(definition);

  return prisma.$transaction(async tx => {
    const current = await tx.runbookVersion.findUnique({
      where: { id: versionId },
      include: { runbook: { select: { archivedAt: true } } },
    });
    if (!current) throw new RunbookVersionNotFoundError(versionId);
    await lockRunbookForUpdate(tx, current.runbookId, { action: 'edit draft for' });
    if (current.state !== 'DRAFT') {
      throw new RunbookVersionImmutableError(versionId, current.state);
    }
    const changed = await tx.runbookVersion.updateMany({
      where: { id: versionId, state: 'DRAFT' },
      data: { definition: definitionJson(definition), checksum },
    });
    if (changed.count !== 1) throw new RunbookVersionImmutableError(versionId, 'PUBLISHED');
    await tx.runbookInput.deleteMany({ where: { runbookVersionId: versionId } });
    if (inputs.length) {
      await tx.runbookInput.createMany({
        data: toInputCreateMany(inputs).map(item => ({ ...item, runbookVersionId: versionId })),
      });
    }
    await logAudit(
      {
        action: 'runbook.version.edited',
        entityType: 'RUNBOOK_VERSION',
        entityId: versionId,
        actorId,
        oldValue: { checksum: current.checksum },
        newValue: { checksum },
      },
      tx
    );
    return tx.runbookVersion.findUniqueOrThrow({
      where: { id: versionId },
      include: { inputs: { orderBy: { sequence: 'asc' } } },
    });
  });
}

/**
 * Publishes the exact immutable draft and retires the previous published
 * version atomically. The checksum is recomputed from stored JSON to detect
 * out-of-band mutations before promotion.
 */
export async function publishDraftVersion(versionId: string, actorId: string) {
  return prisma.$transaction(async tx => {
    const draft = await tx.runbookVersion.findUnique({
      where: { id: versionId },
      include: { runbook: true, inputs: true },
    });
    if (!draft) throw new RunbookVersionNotFoundError(versionId);
    await lockRunbookForUpdate(tx, draft.runbookId, { action: 'publish' });
    if (draft.state !== 'DRAFT') throw new RunbookVersionImmutableError(versionId, draft.state);

    const parsed = parseRunbookDefinition(draft.definition, draft.inputs);
    const checksum = computeDefinitionChecksum(parsed);
    if (checksum !== draft.checksum) {
      throw new RunbookDefinitionError(
        'The draft checksum does not match its stored definition. Save the draft again before publishing.',
        { versionId }
      );
    }

    if (draft.runbook.publishedVersionId) {
      await tx.runbookVersion.updateMany({
        where: { id: draft.runbook.publishedVersionId, state: 'PUBLISHED' },
        data: { state: 'RETIRED' },
      });
    }
    const promoted = await tx.runbookVersion.updateMany({
      where: { id: versionId, state: 'DRAFT' },
      data: { state: 'PUBLISHED', publishedAt: new Date(), publishedById: actorId },
    });
    if (promoted.count !== 1) throw new RunbookVersionImmutableError(versionId, 'PUBLISHED');
    await tx.runbook.update({
      where: { id: draft.runbookId },
      data: { publishedVersionId: versionId, draftVersionId: null },
    });
    await logAudit(
      {
        action: 'runbook.version.published',
        entityType: 'RUNBOOK_VERSION',
        entityId: versionId,
        actorId,
        newValue: { runbookId: draft.runbookId, version: draft.version, checksum },
      },
      tx
    );
    return tx.runbookVersion.findUniqueOrThrow({ where: { id: versionId } });
  });
}

/** Clones any immutable version into the next numbered editable draft. */
export async function cloneVersionToDraft(versionId: string, actorId: string) {
  return runSerializableTransaction(async tx => {
    const source = await tx.runbookVersion.findUnique({
      where: { id: versionId },
      include: { inputs: { orderBy: { sequence: 'asc' } }, runbook: true },
    });
    if (!source) throw new RunbookVersionNotFoundError(versionId);
    await lockRunbookForUpdate(tx, source.runbookId, { action: 'clone draft for' });
    if (source.runbook.draftVersionId) {
      const existing = await tx.runbookVersion.findUnique({
        where: { id: source.runbook.draftVersionId },
      });
      if (existing) return existing;
    }
    const latest = await tx.runbookVersion.aggregate({
      where: { runbookId: source.runbookId },
      _max: { version: true },
    });
    const next = await tx.runbookVersion.create({
      data: {
        runbookId: source.runbookId,
        version: (latest._max.version ?? 0) + 1,
        state: 'DRAFT',
        definition: source.definition as Prisma.InputJsonValue,
        schemaVersion: source.schemaVersion,
        checksum: source.checksum,
        createdById: actorId,
        inputs: source.inputs.length
          ? {
              createMany: {
                data: source.inputs.map((item: RunbookInput) => ({
                  key: item.key,
                  label: item.label,
                  type: item.type,
                  required: item.required,
                  defaultValue: item.defaultValue,
                  description: item.description,
                  sequence: item.sequence,
                })),
              },
            }
          : undefined,
      },
    });
    await tx.runbook.update({
      where: { id: source.runbookId },
      data: { draftVersionId: next.id },
    });
    await logAudit(
      {
        action: 'runbook.version.cloned',
        entityType: 'RUNBOOK_VERSION',
        entityId: next.id,
        actorId,
        details: { sourceVersionId: source.id, version: next.version },
      },
      tx
    );
    return next;
  });
}

export async function archiveRunbook(runbookId: string, actorId: string) {
  return prisma.$transaction(async tx => {
    await lockRunbookForUpdate(tx, runbookId, { allowArchived: true, action: 'archive' });
    const archivedAt = new Date();
    const runbook = await tx.runbook.update({
      where: { id: runbookId },
      data: { archivedAt },
    });
    await tx.serviceRunbookBinding.updateMany({
      where: { runbookId, enabled: true },
      data: { enabled: false },
    });
    await logAudit(
      {
        action: 'runbook.archived',
        entityType: 'RUNBOOK',
        entityId: runbookId,
        actorId,
        newValue: { archivedAt: archivedAt.toISOString() },
      },
      tx
    );
    return runbook;
  });
}

export function summarizeVersionDiff(
  previous: Pick<RunbookVersion, 'version' | 'definition' | 'checksum'>,
  current: Pick<RunbookVersion, 'version' | 'definition' | 'checksum'>
) {
  const before = parseRunbookDefinition(previous.definition);
  const after = parseRunbookDefinition(current.definition);
  const beforeByKey = new Map(before.steps.map(step => [step.key, step]));
  const afterByKey = new Map(after.steps.map(step => [step.key, step]));
  return {
    fromVersion: previous.version,
    toVersion: current.version,
    changed: previous.checksum !== current.checksum,
    added: after.steps.filter(step => !beforeByKey.has(step.key)).map(step => step.key),
    removed: before.steps.filter(step => !afterByKey.has(step.key)).map(step => step.key),
    modified: after.steps
      .filter(step => {
        const old = beforeByKey.get(step.key);
        return old && JSON.stringify(old) !== JSON.stringify(step);
      })
      .map(step => step.key),
  };
}
