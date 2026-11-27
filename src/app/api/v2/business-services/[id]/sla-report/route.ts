import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  getBusinessServiceSlaReport,
  slaReportCsv,
  SlaReportQuerySchema,
} from '@/lib/business-services/sla-report';

/** Monthly SLA report: uptime, SLO met or missed, downtime and incidents; cost only for financial readers. format=csv returns the file. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  // The handler filters to the actor's business services (businessServiceReadWhere).
  scopedFilter: true,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: SlaReportQuerySchema.extend({ format: z.enum(['json', 'csv']).default('json') }),
  handler: async ({ actor, params, query }) => {
    const report = await getBusinessServiceSlaReport(params.id, query.month, actor);
    if (query.format === 'csv') {
      const slug = report.name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'service';
      return new Response(slaReportCsv(report), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="sla-${slug}-${report.month}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return { data: report, headers: { 'Cache-Control': 'no-store' } };
  },
});
