import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import {
  CustomerImpactReportInputSchema,
  createCustomerImpactReport,
  listCustomerImpactReports,
} from '@/lib/business-services/customer-reports';

const params = z.object({ id: z.string().trim().min(1).max(100) }).strict();

/** Customer-reported impact signals for a business service, newest first (at most 200). */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  // The handler filters to the actor's business services (businessServiceReadWhere).
  scopedFilter: true,
  paramsSchema: params,
  querySchema: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).strict(),
  handler: async ({ actor, params, query }) => ({
    data: await listCustomerImpactReports(params.id, actor, query.limit),
    headers: { 'Cache-Control': 'no-store' },
  }),
});

/**
 * Records a batch of customer signals (support tickets, status inquiries). Idempotent by
 * externalRef: re-posting the same reference returns the stored report.
 */
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_CREATE,
  paramsSchema: params,
  querySchema: z.object({}).strict(),
  bodySchema: CustomerImpactReportInputSchema,
  idempotent: true,
  handler: async ({ params, body, actor, tx }) => {
    const { report, created } = await createCustomerImpactReport(
      params.id,
      body,
      { actor, source: 'API' },
      tx
    );
    return {
      status: created ? 201 : 200,
      data: { ...report, created },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
