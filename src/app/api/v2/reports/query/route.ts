import { defineV2Route, enforceV2Authorization } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { calculateActorSLAMetrics } from '@/lib/actor-metrics';
import { projectReportMetric, ReportQueryV2Schema } from '@/lib/api-v2/report-query';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.REPORT_READ,
  bodySchema: ReportQueryV2Schema,
  rateLimitTier: 'SEARCH_EXPORT',
  handler: async ({ actor, body }) => {
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    const result = await calculateActorSLAMetrics(actor, {
      windowDays: body.windowDays,
      ...(body.serviceId ? { serviceId: body.serviceId } : {}),
    });
    return { data: {
      windowDays: body.windowDays,
      serviceId: body.serviceId ?? null,
      effectiveStart: result.effectiveStart,
      effectiveEnd: result.effectiveEnd,
      isClipped: result.isClipped,
      metrics: Object.fromEntries(body.metrics.map(key => [key, projectReportMetric(key, result)])),
    } };
  },
});
