import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import prisma from '@/lib/prisma';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INTEGRATION_READ,
  paramsSchema: z.object({ id: z.string().min(1) }),
  querySchema: z.object({}).strict(),
  rateLimitTier: 'SEARCH_EXPORT',
  handler: async ({ params, actor }) => {
    const row = await prisma.integration.findUnique({ where: { id: params.id }, select: { id: true, type: true, enabled: true, revision: true, createdAt: true, updatedAt: true, serviceId: true, service: { select: { teamId: true } } } });
    if (!row) throw new AppError({ code: 'INTEGRATION_NOT_FOUND' });
    const { enforceV2Authorization } = await import('@/lib/api-v2');
    enforceV2Authorization(actor, AUTHORIZATION_ACTIONS.INTEGRATION_READ, { type: 'service', teamId: row.service.teamId });
    const recent = await prisma.inboundDelivery.findMany({ where: { integrationId: row.id }, orderBy: { createdAt: 'desc' }, take: 20, select: { status: true, createdAt: true, completedAt: true, attempt: true } });
    return { data: { id: row.id, type: row.type, enabled: row.enabled, revision: row.revision, configurationState: row.enabled ? 'ENABLED' : 'DISABLED', deliveryCounts: { recent: recent.length, failed: recent.filter(x => x.status === 'FAILED').length, processing: recent.filter(x => x.status === 'PROCESSING').length }, recentDeliveries: recent.slice(0, 10).map(x => ({ status: x.status, createdAt: x.createdAt, completedAt: x.completedAt, attempt: x.attempt })) }, headers: { 'Cache-Control': 'no-store' } };
  },
});
