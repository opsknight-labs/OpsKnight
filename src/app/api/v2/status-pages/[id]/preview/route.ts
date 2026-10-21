import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { etagHeaders } from '@/lib/api-v2/concurrency';
import { StatusPageParams, requireStatusPageSettings } from '@/lib/api-v2/status-page-settings';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { buildStatusPageSnapshot } from '@/lib/status-pages/snapshot';

/** The same unpublished, privacy-filtered projection used by the status-page editor. */
export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_READ,
  rateLimitTier: 'SEARCH_EXPORT',
  paramsSchema: StatusPageParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const page = await requireStatusPageSettings(prisma, params.id);
    const snapshot = await buildStatusPageSnapshot(page.id, `preview-${page.revision}`);
    return {
      data: { pageId: page.id, revision: page.revision, available: snapshot !== null, snapshot },
      headers: { ...etagHeaders(page.revision), 'Cache-Control': 'private, no-store' },
    };
  },
});
