import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { businessServiceReadWhere } from '@/lib/business-services/commands';
import { getErrorBudgets } from '@/lib/business-services/stats';

/** Error budget and burn state over the SLO window, as the overview shows it; null without an SLO. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_READ,
  // The handler filters to the actor's business services (businessServiceReadWhere).
  scopedFilter: true,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  handler: async ({ actor, params }) => {
    const row = await prisma.businessService.findFirst({
      where: { AND: [{ id: params.id }, businessServiceReadWhere(actor)] },
      select: { id: true, sloTarget: true, sloWindowDays: true },
    });
    if (!row) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    const budget = (await getErrorBudgets([row.id])).get(row.id) ?? null;
    return {
      data: {
        businessServiceId: row.id,
        sloTarget: row.sloTarget,
        sloWindowDays: row.sloWindowDays,
        errorBudget: budget,
      },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
