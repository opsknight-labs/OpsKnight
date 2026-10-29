import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  notificationPreferencesInput,
  prepareNotificationProviderAvailability,
  readNotificationPreferences,
  updateNotificationPreferences,
} from '@/lib/notifications/preferences';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { AppError } from '@/lib/errors';

async function prepareAvailability(context: { body: unknown }) {
  try {
    return await prepareNotificationProviderAvailability(
      context.body as Parameters<typeof prepareNotificationProviderAvailability>[0]
    );
  } catch {
    return null;
  }
}

function requireSelf(actorId: string) {
  if (!actorId)
    throw new AppError({
      code: 'AUTHORIZATION_DENIED',
      userMessage: 'Active user access is required.',
    });
}

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.NOTIFICATION_PREFERENCES_READ,
  querySchema: z.object({}).strict(),
  handler: async context => {
    requireSelf(context.actor.id);
    const data = await readNotificationPreferences(context.actor.id);
    return { data, headers: { ...etagHeaders(data.revision), 'Cache-Control': 'no-store' } };
  },
});

export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.NOTIFICATION_PREFERENCES_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema: notificationPreferencesInput,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  prepare: prepareAvailability,
  replayAuthGuard: async context => requireSelf(context.actor.id),
  handler: async context => {
    requireSelf(context.actor.id);
    if (!context.prepared)
      throw new AppError({
        code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
        userMessage: 'Notification provider state is unavailable. Try again later.',
      });
    const data = await updateNotificationPreferences(context.actor.id, context.body, {
      client: context.tx,
      expectedRevision: requireRevisionIfMatch(context.req),
      availability: context.prepared as Awaited<
        ReturnType<typeof prepareNotificationProviderAvailability>
      >,
      actorApiKeyId: context.apiKey.id,
    });
    return { data, headers: { ...etagHeaders(data.revision), 'Cache-Control': 'no-store' } };
  },
});
