import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { enforceV2Authorization } from '@/lib/api-v2/rbac';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_READ,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INCIDENT_READ);
    const incident = await prisma.incident.findFirst({
      where: { AND: [{ id: params.id }, incidentReadWhere(actor)] },
      select: { id: true },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    const decision = await prisma.incidentAutomationDecision.findUnique({
      where: { incidentId: params.id },
      select: {
        incidentId: true,
        serviceId: true,
        versionId: true,
        mode: true,
        routeType: true,
        escalationPolicyId: true,
        matchedRouteRuleId: true,
        basePriority: true,
        finalPriority: true,
        evaluationAt: true,
        createdAt: true,
      },
    });
    if (!decision) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    return { data: decision, headers: { 'Cache-Control': 'no-store' } };
  },
});
