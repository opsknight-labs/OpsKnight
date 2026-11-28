import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { endAnnouncement } from '@/lib/status-pages/announcement-commands';

const Params = z
  .object({ id: z.string().cuid(), announcementId: z.string().min(1).max(200) })
  .strict();

/**
 * Ends an announcement now: it is set inactive, so the status page stops showing it, and subscriber
 * notices not yet sent are cancelled. Ending an announcement that is already ended answers the same
 * success. An unknown page or announcement is a 404.
 */
export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE,
  paramsSchema: Params,
  querySchema: z.object({}).strict(),
  idempotent: true,
  handler: async ({ params, actor, tx }) => ({
    data: await endAnnouncement(
      {
        statusPageId: params.id,
        announcementId: params.announcementId,
        actorId: actor.id,
        source: 'API',
      },
      tx
    ),
    headers: { 'Cache-Control': 'no-store' },
  }),
});
