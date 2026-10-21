import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { SigningKeyParams, SigningKeySelect, signingCommand } from '@/lib/api-v2/runbook-signing';
import { retireExecutionSigningKey } from '@/lib/runbooks/execution-signing';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_SIGNING_MANAGE,
  paramsSchema: SigningKeyParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ expectedState: z.literal('RETIRING') }).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, actor, apiKey, tx }) =>
    signingCommand(async () => {
      await retireExecutionSigningKey(params.id, { id: actor.id, apiKeyId: apiKey.id }, tx);
      const data = await tx!.runbookExecutionSigningKey.findUniqueOrThrow({
        where: { id: params.id },
        select: SigningKeySelect,
      });
      return { data, headers: { 'Cache-Control': 'no-store' } };
    }),
});
