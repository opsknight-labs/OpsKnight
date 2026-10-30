import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  SigningKeyParams,
  SigningKeySelect,
  guardActiveSigningIdentity,
  signingCommand,
} from '@/lib/api-v2/runbook-signing';
import { activateExecutionSigningKey } from '@/lib/runbooks/execution-signing';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_SIGNING_MANAGE,
  paramsSchema: SigningKeyParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ expectedActiveKeyId: z.string().min(1).max(100) }).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, body, actor, apiKey, tx }) =>
    signingCommand(async () => {
      await guardActiveSigningIdentity(tx!, body.expectedActiveKeyId);
      await activateExecutionSigningKey(params.id, { id: actor.id, apiKeyId: apiKey.id }, tx);
      const data = await tx!.runbookExecutionSigningKey.findUniqueOrThrow({
        where: { id: params.id },
        select: SigningKeySelect,
      });
      return { data, headers: { 'Cache-Control': 'no-store' } };
    }),
});
