import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requireAutomationService } from '@/lib/api-v2/automation-access';
import {
  automationReplayRequestSchema,
  getAutomationReplay,
  startAutomationReplay,
} from '@/lib/automation/replay-run';

const paramsSchema = z.object({ id: z.string().cuid() }).strict();

/** Queues a replay of a draft over the service's stored alerts; an identical request within 10 minutes returns the same run. */
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_READ,
  rateLimitTier: 'SEARCH_EXPORT',
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema: automationReplayRequestSchema,
  handler: async ({ params, actor, body }) => {
    const data = await prisma.$transaction(async tx => {
      await requireAutomationService(tx, params.id, actor);
      return startAutomationReplay(tx, {
        ...body,
        serviceId: params.id,
        actorId: actor.id,
      });
    });
    return { data, status: 202, headers: { 'Cache-Control': 'no-store' } };
  },
});

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_READ,
  paramsSchema,
  querySchema: z.object({ runId: z.string().min(1).max(64) }).strict(),
  handler: async ({ params, actor, query }) => {
    await requireAutomationService(prisma, params.id, actor);
    const data = await getAutomationReplay(prisma, params.id, query.runId);
    if (!data) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    return { data, headers: { 'Cache-Control': 'no-store' } };
  },
});
