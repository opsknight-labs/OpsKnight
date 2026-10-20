import { defineV2Route } from '@/lib/api-v2';
import { DashboardIdV2Schema } from '@/lib/api-v2/dashboards';
import { DashboardDataQueryV2Schema, readDashboardData } from '@/lib/api-v2/dashboard-data';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_READ,
  paramsSchema: DashboardIdV2Schema,
  querySchema: DashboardDataQueryV2Schema,
  scopedFilter: true,
  rateLimitTier: 'SEARCH_EXPORT',
  handler: async ({ actor, params, query }) => {
    return { data: await readDashboardData(actor, params.id, query) };
  },
});
