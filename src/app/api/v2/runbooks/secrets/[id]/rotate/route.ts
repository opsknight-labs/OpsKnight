import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { fingerprintV2SensitiveValue } from '@/lib/api-v2/auth';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { rotateRunbookSecret } from '@/lib/runbooks/secrets';
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.RUNBOOK_SECRET_MANAGE,
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ value: z.string().min(1).max(65536) }).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyPayload: ({ req, body }) => ({
    valueFingerprint: fingerprintV2SensitiveValue(req, body.value),
  }),
  handler: async ({ req, params, body, actor, apiKey, tx }) => {
    const secret = await rotateRunbookSecret(
      params.id,
      body,
      { id: actor.id, apiKeyId: apiKey.id },
      { client: tx, expectedRevision: requireRevisionIfMatch(req) }
    );
    return {
      data: secret,
      headers: { ...etagHeaders(secret.revision), 'Cache-Control': 'no-store' },
    };
  },
});
