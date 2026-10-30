import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requireAutomationService } from '@/lib/api-v2/automation-access';
import { listAutomationObservations } from '@/lib/automation/observation-history';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_READ,
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: z
    .object({
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().max(1000).optional(),
      unmapped: z.enum(['true', 'false']).optional(),
    })
    .strict(),
  handler: async ({ params, actor, query, pagination }) => {
    await requireAutomationService(prisma, params.id, actor);
    const page = await listAutomationObservations(
      prisma,
      params.id,
      pagination.limit,
      pagination.cursor,
      query.unmapped === undefined ? undefined : query.unmapped === 'true'
    );
    return { ...page, headers: { 'Cache-Control': 'no-store' } };
  },
});
