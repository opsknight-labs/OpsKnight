import { requireAutomationService } from '@/lib/api-v2/automation-access';
import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requireRevisionIfMatch, preconditionFailed } from '@/lib/api-v2/concurrency';
import prisma from '@/lib/prisma';
import { publishVersion, AutomationConflict } from '@/lib/automation/versioning';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_PUBLISH,
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: z
    .object({
      expectedActiveVersionId: z.string().cuid().nullable(),
      expectedCandidateVersionId: z.string().cuid().nullable().optional(),
    })
    .strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, actor, tx }) => {
    await requireAutomationService(tx ?? prisma, params.id, actor, true);
  },
  handler: async ({ req, params, body, actor, apiKey, tx }) => {
    await requireAutomationService(tx!, params.id, actor, true);
    try {
      const version = await publishVersion(
        {
          serviceId: params.id,
          actorId: actor.id,
          expectedRevision: requireRevisionIfMatch(req),
          expectedActiveVersionId: body.expectedActiveVersionId,
          expectedCandidateVersionId: body.expectedCandidateVersionId,
        },
        tx,
        apiKey.id
      );
      return {
        data: {
          id: version.id,
          serviceId: version.serviceId,
          versionNumber: version.versionNumber,
          checksum: version.checksum,
        },
        // Publication returns immutable version identity, not a draft validator.
        // Read the draft resource again for its next conditional-write ETag.
        headers: { 'Cache-Control': 'no-store' },
      };
    } catch (error) {
      if (error instanceof AutomationConflict) throw preconditionFailed();
      throw error;
    }
  },
});
