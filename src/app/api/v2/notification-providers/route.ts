import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { listNotificationProviders } from '@/lib/notifications/providers';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.NOTIFICATION_PROVIDER_READ,
  querySchema: z.object({}).strict(),
  handler: async () => ({
    data: await listNotificationProviders(),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
