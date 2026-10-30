import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requireAutomationService } from '@/lib/api-v2/automation-access';
import { readAutomationVersion } from '@/lib/automation/history';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_READ,
  paramsSchema: z.object({ id: z.string().cuid(), versionId: z.string().cuid() }).strict(),
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    await requireAutomationService(prisma, params.id, actor);
    return {
      data: await readAutomationVersion(prisma, params.id, params.versionId),
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
