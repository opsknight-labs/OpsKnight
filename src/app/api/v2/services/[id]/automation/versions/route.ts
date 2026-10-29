import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requireAutomationService } from '@/lib/api-v2/automation-access';
import { listAutomationHistory } from '@/lib/automation/history';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_READ,
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: z
    .object({
      limit: z.coerce.number().int().min(1).max(100).optional(),
      cursor: z.string().max(1000).optional(),
    })
    .strict(),
  handler: async ({ params, actor, pagination }) => {
    await requireAutomationService(prisma, params.id, actor);
    const page = await listAutomationHistory(
      prisma,
      params.id,
      pagination.limit,
      pagination.cursor
    );
    return { ...page, headers: { 'Cache-Control': 'no-store' } };
  },
});
