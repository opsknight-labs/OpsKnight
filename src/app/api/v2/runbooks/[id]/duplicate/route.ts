import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { RunbookParams } from '@/lib/api-v2/runbook-authoring';
import { duplicateRunbook } from '@/lib/runbooks/lifecycle';
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
    const result = await duplicateRunbook(params.id, { id: actor.id, apiKeyId: apiKey.id }, tx);
    return {
      status: 201,
      ...runbookMetadataResult(await tx!.runbook.findUniqueOrThrow({ where: { id: result.id } })),
    };
  },
});
