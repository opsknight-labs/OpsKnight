import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { ObjectiveParams, requireReadableObjective } from '@/lib/api-v2/service-objectives';
import { SLO_ALERT_BOUNDS } from '@/lib/slo/burn-alerts/contract';
import { getSloBurnHistory } from '@/lib/slo/burn-alerts/service';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_READ,
  scopedFilter: true,
  paramsSchema: ObjectiveParams,
  querySchema: z
    .object({
      hours: z.coerce
        .number()
        .int()
        .min(1)
        .max(SLO_ALERT_BOUNDS.historyMaxHours)
        .default(SLO_ALERT_BOUNDS.historyDefaultHours),
    })
    .strict(),
  handler: async ({ actor, params, query }) => {
    await requireReadableObjective(prisma, actor, params.id);
    const history = await getSloBurnHistory(params.id, query.hours);
    if (!history) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    return { data: history, headers: { 'Cache-Control': 'no-store' } };
  },
});
