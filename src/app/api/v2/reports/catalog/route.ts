import { defineV2Route } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { REPORT_METRIC_CATALOG } from '@/lib/api-v2/report-query';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_READ,
  handler: async () => ({ data: {
    metrics: REPORT_METRIC_CATALOG,
    dimensions: ['serviceId'],
    windowDays: { min: 1, max: 90, default: 30 },
  } }),
});
