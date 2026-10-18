import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import prisma from '@/lib/prisma';
import { activateCandidate, AutomationConflict } from '@/lib/automation/versioning';
import { preconditionFailed } from '@/lib/api-v2/concurrency';

async function assertAutomationWriteAccess(
  client: typeof prisma | Parameters<typeof prisma.$transaction>[0],
  serviceId: string,
  actor: { role: string; id: string }
) {
  const service = await (client as typeof prisma).service.findUnique({
    where: { id: serviceId },
    select: { teamId: true },
  });
  if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
  if (actor.role !== 'ADMIN') {
    const membership = service.teamId
      ? await (client as typeof prisma).teamMember.findFirst({
          where: { teamId: service.teamId, userId: actor.id },
          select: { id: true },
        })
      : null;
    if (!membership) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  }
}

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.AUTOMATION_PUBLISH,
  paramsSchema: z.object({ id: z.string().cuid() }).strict(),
  querySchema: z.object({}).strict(),
  bodySchema: z
    .object({
      expectedCandidateVersionId: z.string().cuid(),
      expectedActiveVersionId: z.string().cuid().nullable().optional(),
      acknowledgeNoShadow: z.boolean().optional(),
      acknowledgeShadowErrors: z.boolean().optional(),
      acknowledgeMaterialDifferences: z.boolean().optional(),
    })
    .strict(),
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, actor, tx }) => {
    if (tx) {
      await tx.$queryRaw`SELECT id FROM "Service" WHERE id = ${params.id} FOR SHARE`;
    }
    await assertAutomationWriteAccess((tx ?? prisma) as typeof prisma, params.id, actor);
  },
  handler: async ({ params, body, actor, apiKey, tx }) => {
    await tx!.$queryRaw`SELECT id FROM "Service" WHERE id = ${params.id} FOR SHARE`;
    await assertAutomationWriteAccess(tx! as unknown as typeof prisma, params.id, actor);
    try {
      const updated = await activateCandidate(
        {
          serviceId: params.id,
          actorId: actor.id,
          expectedCandidateVersionId: body.expectedCandidateVersionId,
          expectedActiveVersionId: body.expectedActiveVersionId,
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
