import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { requireRevisionIfMatch, preconditionFailed } from '@/lib/api-v2/concurrency';
import { publishVersion, AutomationConflict } from '@/lib/automation/versioning';

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_PUBLISH,
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ expectedActiveVersionId: z.string().cuid().nullable() }).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ req, params, body, actor, apiKey, tx }) => {
    const service = await tx!.service.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
    try {
      const version = await publishVersion(
        {
          serviceId: params.id,
          actorId: actor.id,
          expectedRevision: requireRevisionIfMatch(req),
          expectedActiveVersionId: body.expectedActiveVersionId,
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
