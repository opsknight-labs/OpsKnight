import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { StatusPageParams, requireStatusPageSettings } from '@/lib/api-v2/status-page-settings';
import { requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { requestStatusPagePublicationRetry } from '@/lib/status-pages/publication-jobs';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE,
  paramsSchema: StatusPageParams,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({}).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ tx, params }) => {
    await requireStatusPageSettings(tx!, params.id);
  },
  handler: async ({ tx, params, req, actor, apiKey }) => {
    const job = await requestStatusPagePublicationRetry(
      tx!,
      params.id,
      requireRevisionIfMatch(req),
      { id: actor.id, apiClientId: apiKey.id }
    );
    return {
      status: 202,
      data: job,
      headers: {
        'Cache-Control': 'no-store',
        Location: `/api/v2/status-pages/${params.id}/publication/jobs/${job.id}`,
      },
    };
  },
});
