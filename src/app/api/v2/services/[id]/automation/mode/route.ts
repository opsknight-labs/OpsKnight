import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { requireAutomationService } from '@/lib/api-v2/automation-access';
import { requireRevisionIfMatch, etagHeaders, preconditionFailed } from '@/lib/api-v2/concurrency';
import { changeMode, AutomationConflict } from '@/lib/automation/versioning';
import { readAutomationConfiguration } from '@/lib/automation/configuration';

export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_PUBLISH,
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: z
    .object({
      mode: z.enum(['DISABLED', 'SHADOW', 'LIVE']),
      expectedActiveVersionId: z.string().cuid().nullable(),
      acknowledgeNoShadow: z.boolean().optional(),
      acknowledgeShadowErrors: z.boolean().optional(),
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
      await changeMode(
        {
          ...body,
          serviceId: params.id,
          actorId: actor.id,
          expectedConfigRevision: requireRevisionIfMatch(req),
        },
        tx,
        apiKey.id
      );
      const data = await readAutomationConfiguration(tx!, params.id);
      return { data, headers: { ...etagHeaders(data.revision), 'Cache-Control': 'no-store' } };
    } catch (error) {
      if (error instanceof AutomationConflict) throw preconditionFailed();
      throw error;
    }
  },
});
