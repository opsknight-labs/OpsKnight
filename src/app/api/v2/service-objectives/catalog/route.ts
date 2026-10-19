import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { SERVICE_OBJECTIVE_CONTRACT } from '@/lib/slo/contract';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_READ,
  scopedFilter: true,
  querySchema: z.object({}).strict(),
  handler: async () => ({
    data: SERVICE_OBJECTIVE_CONTRACT,
    headers: { 'Cache-Control': 'no-store' },
  }),
});
