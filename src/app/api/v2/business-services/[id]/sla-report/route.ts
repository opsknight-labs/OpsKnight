import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  getBusinessServiceSlaReport,
  SlaReportQuerySchema,
} from '@/lib/business-services/sla-report';

/** Monthly SLA report: uptime, SLO met or missed, downtime and incidents; cost only for financial readers. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  // The handler filters to the actor's business services (businessServiceReadWhere).
  scopedFilter: true,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: SlaReportQuerySchema,
  handler: async ({ actor, params, query }) => ({
    data: await getBusinessServiceSlaReport(params.id, query.month, actor),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
