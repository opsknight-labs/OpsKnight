import type { getVersionImpact } from '@/lib/runbooks/version-impact';
import type { Prisma, Runbook } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '@/lib/errors';
import { lockRunbookForUpdate } from '@/lib/runbooks/locking';
import { updateRunbookSchema } from '@/lib/runbooks/schemas';
import { etagHeaders, preconditionFailed, requireRevisionIfMatch } from './concurrency';

export const RunbookMetadataPatch = updateRunbookSchema
  .strict()
  .refine(input => Object.keys(input).length > 0, 'At least one metadata field is required.');
export const RunbookDeleteBody = z
  .object({ confirmationText: z.string().trim().min(1).max(200) })
  .strict();
export function projectRunbookMetadata(runbook: Runbook) {
  return {
    id: runbook.id,
    name: runbook.name,
    slug: runbook.slug,
    description: runbook.description,
    ownerTeamId: runbook.ownerTeamId,
    tags: runbook.tags,
    archivedAt: runbook.archivedAt,
    publishedVersionId: runbook.publishedVersionId,
    draftVersionId: runbook.draftVersionId,
    revision: runbook.revision,
    createdAt: runbook.createdAt,
    updatedAt: runbook.updatedAt,
  };
}
export function runbookMetadataResult(runbook: Runbook) {
  return { data: projectRunbookMetadata(runbook), headers: etagHeaders(runbook.revision) };
}
/** All metadata/lifecycle writes use the same parent lock as UI authoring and execution. */
export async function requireRunbookRevision(
  tx: Prisma.TransactionClient,
  req: Request,
  id: string
) {
  const expected = requireRevisionIfMatch(req);
  await lockRunbookForUpdate(tx, id, { allowArchived: true, action: 'manage' });
  const current = await tx.runbook.findUnique({ where: { id } });
  if (!current) throw new AppError({ code: 'RUNBOOK_NOT_FOUND' });
  if (current.revision !== expected) throw preconditionFailed();
  return current;
}

/** Only structural summaries leave the boundary; commands, URLs, defaults and secret references do not. */
export function projectRunbookImpact(impact: Awaited<ReturnType<typeof getVersionImpact>>) {
  const summarize = (step: (typeof impact.steps)[number]['before']) =>
    step
      ? {
          key: step.key,
          name: step.name,
          type: step.type,
          riskClass: step.riskClass,
          requiresApproval: step.requiresApproval === true || step.type === 'APPROVAL',
        }
      : null;
  return {
    ...impact,
    steps: impact.steps.map(step => ({
      key: step.key,
      change: step.change,
      risk: step.risk,
      before: summarize(step.before),
      after: summarize(step.after),
    })),
  };
}
