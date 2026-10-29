import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { notificationProviderKeySchema } from '@/lib/notifications/provider-schema';
import { notificationProviderDiagnostics } from '@/lib/notifications/providers';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.NOTIFICATION_PROVIDER_READ,
  paramsSchema: z.object({ provider: notificationProviderKeySchema }),
  querySchema: z.object({}).strict(),
  rateLimitTier: 'SEARCH_EXPORT',
  handler: async context => ({
    data: await notificationProviderDiagnostics(context.params.provider),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
