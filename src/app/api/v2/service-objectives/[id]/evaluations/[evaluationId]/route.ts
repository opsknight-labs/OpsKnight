import prisma from '@/lib/prisma';
import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { ObjectiveParams } from '@/lib/api-v2/service-objectives';
import { readObjectiveEvaluationJob } from '@/lib/slo/evaluation-jobs';
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_READ,
  scopedFilter: true,
  paramsSchema: ObjectiveParams.extend({ evaluationId: z.string().uuid() }).strict(),
  querySchema: z.object({}).strict(),
  handler: async ({ actor, params }) => ({
    data: await readObjectiveEvaluationJob(prisma, actor, params.id, params.evaluationId),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
