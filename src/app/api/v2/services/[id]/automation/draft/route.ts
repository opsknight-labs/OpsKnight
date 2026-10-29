import { requireAutomationService } from '@/lib/api-v2/automation-access';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { etagHeaders, requireRevisionIfMatch, preconditionFailed } from '@/lib/api-v2/concurrency';
import { emptySnapshot, snapshotSchema } from '@/lib/automation/contract';
import { saveDraft, AutomationConflict } from '@/lib/automation/versioning';

const paramsSchema = z.object({ id: z.string().cuid() }).strict();
const querySchema = z.object({}).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_READ,
  paramsSchema,
  querySchema,
  handler: async ({ params }) => {
    const service = await prisma.service.findUnique({
      where: { id: params.id },
      select: {
        id: true,
        automationDraft: {
          select: { revision: true, snapshot: true, restoredFromVersionId: true },
        },
      },
    });
    if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
    const data = {
      serviceId: service.id,
      revision: service.automationDraft?.revision ?? 0,
      restoredFromVersionId: service.automationDraft?.restoredFromVersionId ?? null,
      snapshot: snapshotSchema.parse(service.automationDraft?.snapshot ?? emptySnapshot),
    };
    return { data, headers: { ...etagHeaders(data.revision), 'Cache-Control': 'no-store' } };
  },
});

export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_WRITE,
  paramsSchema,
  querySchema,
  bodySchema: z.object({ snapshot: snapshotSchema }).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  /**
   * Re-check team membership before returning a cached replay result.
   * The mutation handler is skipped on replay, so without this guard a responder
   * whose team membership was revoked after the original write can still receive
   * the stored draft response with the same idempotency key indefinitely.
   */
  replayAuthGuard: async ({ params, actor, tx }) => {
    await requireAutomationService(tx ?? prisma, params.id, actor, true);
  },
  handler: async ({ req, params, body, actor, apiKey, tx }) => {
    await requireAutomationService(tx!, params.id, actor, true);
    try {
      const draft = await saveDraft(
        {
          serviceId: params.id,
          actorId: actor.id,
          snapshot: body.snapshot,
          expectedRevision: requireRevisionIfMatch(req),
        },
        tx,
        apiKey.id
      );
      return {
        data: {
          serviceId: params.id,
          revision: draft.revision,
          restoredFromVersionId: draft.restoredFromVersionId,
          snapshot: snapshotSchema.parse(draft.snapshot),
        },
        headers: { ...etagHeaders(draft.revision), 'Cache-Control': 'no-store' },
      };
    } catch (error) {
      if (error instanceof AutomationConflict) throw preconditionFailed();
      throw error;
    }
  },
});
