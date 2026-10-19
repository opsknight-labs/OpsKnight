import { safePublicationDiagnostic } from '@/lib/status-pages/publication-diagnostics';
import prisma from '@/lib/prisma';
import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { StatusPageParams, requireStatusPageSettings } from '@/lib/api-v2/status-page-settings';
import { etagHeaders } from '@/lib/api-v2/concurrency';
import { readStatusPagePublicationState } from '@/lib/status-pages/publish-configuration';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_READ,
  paramsSchema: StatusPageParams,
  querySchema: z.object({}).strict(),
  handler: async ({ params }) => {
    const page = await requireStatusPageSettings(prisma, params.id);
    return {
      data: {
        id: page.id,
        revision: page.revision,
        publication: safePublicationDiagnostic(await readStatusPagePublicationState(page.id)),
      },
      headers: { ...etagHeaders(page.revision), 'Cache-Control': 'no-store' },
    };
  },
});
