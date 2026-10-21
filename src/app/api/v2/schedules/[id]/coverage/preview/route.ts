import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { previewScheduleLayer } from '@/lib/schedules/layer-preview';
import { scheduleLayerBodySchema } from '@/lib/schedules/layer-commands';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE,
  rateLimitTier: 'SEARCH_EXPORT',
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: z.object({
    start: z.string().datetime(),
    end: z.string().datetime(),
    layerId: z.string().trim().min(1).max(100).nullable(),
    proposedLayer: scheduleLayerBodySchema,
  }).strict(),
  preconditionRequired: true,
  handler: async ({ params, body, req }) => {
    const result = await prisma.$transaction(tx => previewScheduleLayer(
      tx, params.id, requireRevisionIfMatch(req),
      new Date(body.start), new Date(body.end),
      body.layerId, body.proposedLayer
    ), { isolationLevel: 'RepeatableRead', timeout: 20_000 });
    return { data: result, headers: { 'Cache-Control': 'private, no-store' } };
  },
});
