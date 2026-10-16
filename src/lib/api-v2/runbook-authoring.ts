import type { Prisma, RunbookVersion } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { etagHeaders, requireIfMatch, preconditionFailed } from './concurrency';
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
  const expected = requireIfMatch(req);
  await lockRunbookForUpdate(tx, params.id);
  const draft = await tx.runbookVersion.findFirst({
    where: { id: params.versionId, runbookId: params.id },
  });
  if (!draft) throw new AppError({ code: 'RUNBOOK_VERSION_NOT_FOUND' });
  if (expected !== null && draft.draftRevision !== expected) throw preconditionFailed();
  return draft;
}

export function authoringVersionResult(version: RunbookVersion) {
  return { data: projectAuthoringVersion(version), headers: etagHeaders(version.draftRevision) };
}
