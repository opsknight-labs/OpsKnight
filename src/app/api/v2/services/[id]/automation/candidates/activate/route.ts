import { requireAutomationService } from '@/lib/api-v2/automation-access';
import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import prisma from '@/lib/prisma';
import { activateCandidate, AutomationConflict } from '@/lib/automation/versioning';
import { preconditionFailed } from '@/lib/api-v2/concurrency';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_PUBLISH,
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: z
    .object({
      expectedCandidateVersionId: z.string().cuid(),
      expectedActiveVersionId: z.string().cuid().nullable().optional(),
      expectedReadinessPolicyRevision: z.number().int().nonnegative().optional(),
      acknowledgeNoShadow: z.boolean().optional(),
      acknowledgeShadowErrors: z.boolean().optional(),
      acknowledgeMaterialDifferences: z.boolean().optional(),
    })
    .strict(),
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, actor, tx }) => {
    await requireAutomationService(tx ?? prisma, params.id, actor, true);
  },
  handler: async ({ params, body, actor, apiKey, tx }) => {
    await requireAutomationService(tx!, params.id, actor, true);
    try {
      const updated = await activateCandidate(
        {
          serviceId: params.id,
          actorId: actor.id,
          expectedCandidateVersionId: body.expectedCandidateVersionId,
          expectedActiveVersionId: body.expectedActiveVersionId,
          expectedReadinessPolicyRevision: body.expectedReadinessPolicyRevision,
          acknowledgeNoShadow: body.acknowledgeNoShadow,
          acknowledgeShadowErrors: body.acknowledgeShadowErrors,
          acknowledgeMaterialDifferences: body.acknowledgeMaterialDifferences,
        },
        tx,
        apiKey.id
      );
      return {
        data: {
          serviceId: updated.serviceId,
          activeVersionId: updated.activeVersionId,
          candidateVersionId: updated.candidateVersionId,
        },
        headers: { 'Cache-Control': 'no-store' },
      };
    } catch (error) {
      if (error instanceof AutomationConflict) throw preconditionFailed();
      throw error;
    }
  },
});
