import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { rotateWebPushKeys } from '@/lib/notifications/providers';

const bodySchema = z
  .object({
    subject: z
      .string()
      .trim()
      .min(1)
      .max(320)
      .refine(
        value => /^(mailto:|https:\/\/)/.test(value),
        'Subject must be a mailto: address or HTTPS URL.'
      ),
    keepPrevious: z.boolean().default(true),
  })
  .strict();

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.NOTIFICATION_PROVIDER_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  idempotencyScope: 'POST:/api/v2/notification-providers/web-push/rotate',
  handler: async context => {
    const result = await rotateWebPushKeys({
      subject: context.body.subject,
      keepPrevious: context.body.keepPrevious,
      actorId: context.actor.id,
      actorApiKeyId: context.apiKey.id,
      expectedRevision: requireRevisionIfMatch(context.req),
      client: context.tx,
    });
    return {
      data: { publicKey: result.publicKey, subject: result.subject, provider: result.provider },
      headers: { ...etagHeaders(result.provider.revision), 'Cache-Control': 'no-store' },
    };
  },
});
