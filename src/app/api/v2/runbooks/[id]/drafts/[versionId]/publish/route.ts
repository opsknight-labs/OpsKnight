import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { DraftParams, requireDraft, authoringVersionResult } from '@/lib/api-v2/runbook-authoring';
import { publishDraftVersion } from '@/lib/runbooks/versioning';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_PUBLISH,
  paramsSchema: DraftParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ req, params, actor, apiKey, tx }) => {
    const draft = await requireDraft(tx!, req, params);
    return authoringVersionResult(
      await publishDraftVersion(draft.id, { id: actor.id, apiKeyId: apiKey.id }, tx)
    );
  },
});
