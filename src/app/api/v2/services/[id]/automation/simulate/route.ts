import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requireAutomationService } from '@/lib/api-v2/automation-access';
import { automationSimulationSchema } from '@/lib/automation/authoring-contract';
import { simulateAutomationSnapshot, publicAutomationSimulation } from '@/lib/automation/authoring';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_READ,
  rateLimitTier: 'SEARCH_EXPORT',
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: automationSimulationSchema,
  handler: async ({ params, actor, body }) => {
    const data = await prisma.$transaction(async tx => {
      await requireAutomationService(tx, params.id, actor);
      return publicAutomationSimulation(
        await simulateAutomationSnapshot(tx, {
          ...body,
          providerPayload: body.providerPayload,
          serviceId: params.id,
          evaluationAt: body.evaluationAt ?? new Date().toISOString(),
        })
      );
    });
    return { data, headers: { 'Cache-Control': 'no-store' } };
  },
});
