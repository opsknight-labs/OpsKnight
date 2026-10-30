import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requireAutomationService } from '@/lib/api-v2/automation-access';
import { requireRevisionIfMatch, etagHeaders, preconditionFailed } from '@/lib/api-v2/concurrency';
import { restoreAutomationDraft } from '@/lib/automation/authoring';
import { AutomationConflict } from '@/lib/automation/versioning';
import { snapshotSchema } from '@/lib/automation/contract';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_WRITE,
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ sourceVersionId: z.string().cuid() }).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, actor, tx }) => {
    await requireAutomationService(tx ?? prisma, params.id, actor, true);
  },
  handler: async ({ req, params, actor, apiKey, body, tx }) => {
    await requireAutomationService(tx!, params.id, actor, true);
    try {
      const draft = await restoreAutomationDraft(
        {
          ...body,
          serviceId: params.id,
          actorId: actor.id,
          expectedRevision: requireRevisionIfMatch(req),
        },
        tx,
        apiKey.id
      );
      return {
        data: {
          serviceId: params.id,
          revision: draft.revision,
          snapshot: snapshotSchema.parse(draft.snapshot),
          restoredFromVersionId: draft.restoredFromVersionId,
        },
        headers: { ...etagHeaders(draft.revision), 'Cache-Control': 'no-store' },
      };
    } catch (error) {
      if (error instanceof AutomationConflict) throw preconditionFailed();
      throw error;
    }
  },
});
