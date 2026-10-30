import prisma from '@/lib/prisma';
import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { StatusPageParams, requireStatusPageSettings } from '@/lib/api-v2/status-page-settings';
import { getStatusPagePublicationJob } from '@/lib/status-pages/publication-jobs';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_READ,
  paramsSchema: StatusPageParams.extend({ jobId: z.string().uuid() }).strict(),
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    await requireStatusPageSettings(prisma, params.id);
    return {
      data: await getStatusPagePublicationJob(prisma, params.id, params.jobId),
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
