import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { RunbookParams, authoringVersionResult } from '@/lib/api-v2/runbook-authoring';
import { cloneVersionToDraft } from '@/lib/runbooks/versioning';
import { AppError } from '@/lib/errors';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_MANAGE,
  paramsSchema: RunbookParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ sourceVersionId: z.string().cuid() }).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, body, actor, apiKey, tx }) => {
    const source = await tx!.runbookVersion.findFirst({
      where: { id: body.sourceVersionId, runbookId: params.id },
      select: { id: true },
    });
    if (!source) throw new AppError({ code: 'RUNBOOK_VERSION_NOT_FOUND' });
    return {
      status: 201,
      ...authoringVersionResult(
        await cloneVersionToDraft(source.id, { id: actor.id, apiKeyId: apiKey.id }, tx)
      ),
    };
  },
});
