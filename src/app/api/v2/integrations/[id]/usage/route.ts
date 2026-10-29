import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import prisma from '@/lib/prisma';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INTEGRATION_READ,
  paramsSchema: z.object({ id: z.string().min(1) }),
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    const integration = await prisma.integration.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        name: true,
        type: true,
        serviceId: true,
        service: { select: { id: true, name: true, teamId: true } },
      },
    });
    if (!integration) throw new AppError({ code: 'INTEGRATION_NOT_FOUND' });
    const { enforceV2Authorization } = await import('@/lib/api-v2');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INTEGRATION_READ, {
      type: 'service',
      teamId: integration.service.teamId,
    });
    const [deliveries, automationObservations, serviceAutomationRules] = await Promise.all([
      prisma.inboundDelivery.groupBy({
        by: ['status'],
        where: { integrationId: integration.id },
        _count: { _all: true },
      }),
      prisma.automationContextObservation.count({ where: { integrationId: integration.id } }),
      prisma.serviceAutomationRule.count({
        where: { serviceId: integration.serviceId, enabled: true },
      }),
    ]);
    return {
      data: {
        id: integration.id,
        type: integration.type,
        service: { id: integration.service.id, name: integration.service.name },
        deliveriesByStatus: Object.fromEntries(
          deliveries.map(row => [row.status, row._count._all])
        ),
        automationObservations,
        enabledServiceRunbookBindings: serviceAutomationRules,
      },
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
