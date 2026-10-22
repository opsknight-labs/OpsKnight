import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { INTEGRATION_TYPES } from '@/lib/integrations/catalog';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INTEGRATION_READ,
  querySchema: z.object({}).strict(),
  handler: async () => ({
    data: INTEGRATION_TYPES.map(type => ({
      type,
      direction: 'INBOUND',
      authentication: type === 'CLOUDWATCH' ? ['integration-key', 'sns-signature'] : ['integration-key', 'optional-signature'],
      configurationFields: type === 'CLOUDWATCH' ? ['snsTopicArn'] : [],
      testMode: 'LOCAL_PAYLOAD_VALIDATION',
    })),
    headers: { 'Cache-Control': 'public, max-age=300, stale-while-revalidate=600' },
  }),
});
