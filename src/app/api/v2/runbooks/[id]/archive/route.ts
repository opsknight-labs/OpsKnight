import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { RunbookParams } from '@/lib/api-v2/runbook-authoring';
import { archiveRunbook } from '@/lib/runbooks/versioning';
import { requireRunbookRevision, runbookMetadataResult } from '@/lib/api-v2/runbook-lifecycle';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_MANAGE,
  paramsSchema: RunbookParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, req, tx, actor, apiKey }) => {
    await requireRunbookRevision(tx!, req, params.id);
    const result = await archiveRunbook(params.id, { id: actor.id, apiKeyId: apiKey.id }, tx);
    return runbookMetadataResult(result);
  },
});
