import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { revokeRunbookSecretGrant } from '@/lib/runbooks/secrets';
export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_SECRET_GRANT,
  paramsSchema: z.object({ id: z.string().cuid(), grantId: z.string().cuid() }).strict(),
  querySchema: z.object({}).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ req, params, actor, apiKey, tx }) => {
    await revokeRunbookSecretGrant(
      params.grantId,
      { id: actor.id, apiKeyId: apiKey.id },
      { client: tx, secretId: params.id, expectedRevision: requireRevisionIfMatch(req) }
    );
    return { status: 204, headers: { 'Cache-Control': 'no-store' } };
  },
});
