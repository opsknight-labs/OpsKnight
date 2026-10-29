import type { Prisma, RunbookInput, RunbookVersion } from '@prisma/client';
import { z } from 'zod/v3';
import { AppError } from '@/lib/errors';
import { etagHeaders, requireRevisionIfMatch, preconditionFailed } from './concurrency';
import { projectRunbookSteps } from './runbook-projection';
import { lockRunbookForUpdate } from '@/lib/runbooks/locking';
import {
  createRunbookSchema,
  runbookDefinitionSchema,
  runbookInputsSchema,
} from '@/lib/runbooks/schemas';

export const RunbookParams = z.object({ id: z.string().cuid() }).strict();
export const DraftParams = RunbookParams.extend({ versionId: z.string().cuid() }).strict();
export const CreateRunbookV2Schema = createRunbookSchema
  .pick({ name: true, slug: true, description: true })
  .extend({
    definition: runbookDefinitionSchema.optional(),
    inputs: runbookInputsSchema.optional(),
  })
  .strict();
export const EditDraftV2Schema = z
  .object({
    definition: runbookDefinitionSchema,
    inputs: runbookInputsSchema.default([]),
    preserveConfiguration: z.boolean().default(false),
  })
  .strict();

/** Never serialize executable configuration, input defaults or secret references. */
export function projectAuthoringVersion(version: RunbookVersion) {
  return {
    id: version.id,
    runbookId: version.runbookId,
    version: version.version,
    state: version.state,
    checksum: version.checksum,
    draftRevision: version.draftRevision,
    publishedAt: version.publishedAt,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    steps: projectRunbookSteps(version.definition),
  };
}

/** Parent and revision checks occur under the same lock/transaction as the domain command. */
export async function requireDraft(
  tx: Prisma.TransactionClient,
  req: Request,
  params: z.infer<typeof DraftParams>
) {
  const expected = requireRevisionIfMatch(req);
  await lockRunbookForUpdate(tx, params.id);
  const draft = await tx.runbookVersion.findFirst({
    where: { id: params.versionId, runbookId: params.id },
    include: { inputs: { orderBy: { sequence: 'asc' } } },
  });
  if (!draft) throw new AppError({ code: 'RUNBOOK_VERSION_NOT_FOUND' });
  if (draft.draftRevision !== expected) throw preconditionFailed();
  return draft;
}

export function authoringVersionResult(version: RunbookVersion) {
  return { data: projectAuthoringVersion(version), headers: etagHeaders(version.draftRevision) };
}

/** Only explicit authoring credentials receive this editable, configuration-free view. */
export function editableDraftResult(version: RunbookVersion & { inputs: RunbookInput[] }) {
  const hide = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(hide);
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, key === 'config' ? {} : hide(nested)])
      );
    }
    return value;
  };
  return {
    ...authoringVersionResult(version),
    data: {
      ...projectAuthoringVersion(version),
      editable: {
        definition: hide(version.definition),
        inputs: version.inputs.map(input => ({
          key: input.key,
          label: input.label,
          type: input.type,
          required: input.required,
          description: input.description,
          sequence: input.sequence,
          options: input.options,
        })),
        preserveConfiguration: true,
      },
    },
    headers: { ...etagHeaders(version.draftRevision), 'Cache-Control': 'no-store' },
  };
}

/** Resolve omissions against the locked exact revision, using step/input keys, never array positions. */
export function restoreDraftConfiguration(
  body: z.infer<typeof EditDraftV2Schema>,
  draft: RunbookVersion & { inputs: RunbookInput[] }
) {
  if (!body.preserveConfiguration) return body;
  const stepKey = (step: unknown): string | undefined =>
    step && typeof step === 'object' && 'key' in step && typeof step.key === 'string'
      ? step.key
      : undefined;
  const restore = (value: unknown, previous: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    const old = previous && typeof previous === 'object' ? previous : {};
    const oldFields = new Map(Object.entries(old));
    const fields = new Map(Object.entries(value));
    return Object.fromEntries(
      [...fields].map(([key, nested]) => {
        if (key === 'steps' && Array.isArray(nested)) {
          const oldSteps = oldFields.get('steps');
          const byKey = new Map<string | undefined, unknown>(
            (Array.isArray(oldSteps) ? (oldSteps as unknown[]) : []).map(step => [
              stepKey(step),
              step,
            ])
          );
          return [key, nested.map(step => restore(step, byKey.get(stepKey(step))))];
        }
        if (key === 'config') {
          // A supplied configuration is a complete replacement, never recursively merged.
          if (!nested || typeof nested !== 'object' || Object.keys(nested).length)
            return [key, nested];
          if (oldFields.has('config') && fields.get('type') !== oldFields.get('type')) {
            throw new AppError({
              code: 'VALIDATION_FAILED',
              userMessage: 'Replacing a step type requires explicit configuration.',
            });
          }
          return [key, oldFields.get('config') ?? nested];
        }
        return [key, restore(nested, oldFields.get(key))];
      })
    );
  };
  const previousInputs = new Map(draft.inputs.map(input => [input.key, input]));
  return EditDraftV2Schema.parse({
    ...body,
    definition: restore(body.definition, draft.definition),
    inputs: body.inputs.map(input => {
      const previous = previousInputs.get(input.key);
      return input.defaultValue === undefined &&
        previous?.type === input.type &&
        previous.defaultValue !== null
        ? { ...input, defaultValue: previous.defaultValue }
        : input;
    }),
  });
}
