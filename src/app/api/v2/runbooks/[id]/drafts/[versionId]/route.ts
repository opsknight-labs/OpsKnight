import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  DraftParams,
  EditDraftV2Schema,
  requireDraft,
  authoringVersionResult,
  editableDraftResult,
  restoreDraftConfiguration,
} from '@/lib/api-v2/runbook-authoring';
import { updateDraftVersion } from '@/lib/runbooks/versioning';
import { AppError } from '@/lib/errors';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_MANAGE,
  paramsSchema: DraftParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const version = await prisma.runbookVersion.findFirst({
      where: { id: params.versionId, runbookId: params.id, state: 'DRAFT' },
      include: { inputs: { orderBy: { sequence: 'asc' } } },
    });
    if (!version) throw new AppError({ code: 'RUNBOOK_VERSION_NOT_FOUND' });
    return editableDraftResult(version);
  },
});

export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_MANAGE,
  paramsSchema: DraftParams,
  querySchema: z.object({}).strict(),
  bodySchema: EditDraftV2Schema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ req, params, body, actor, apiKey, tx }) => {
    const draft = await requireDraft(tx!, req, params);
    const updated = await updateDraftVersion(
      draft.id,
      { ...restoreDraftConfiguration(body, draft), expectedDraftRevision: draft.draftRevision },
      { id: actor.id, apiKeyId: apiKey.id },
      tx
    );
    return authoringVersionResult(updated);
  },
});
