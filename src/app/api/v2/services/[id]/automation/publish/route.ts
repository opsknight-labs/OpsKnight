import { z } from 'zod';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { requireRevisionIfMatch, preconditionFailed } from '@/lib/api-v2/concurrency';
import prisma from '@/lib/prisma';
import { publishVersion, AutomationConflict } from '@/lib/automation/versioning';

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
  bodySchema: z.object({ expectedActiveVersionId: z.string().cuid().nullable() }).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, actor }) => {
    await assertAutomationWriteAccess(prisma, params.id, actor);
  },
  handler: async ({ req, params, body, actor, apiKey, tx }) => {
    await tx!.$queryRaw`SELECT id FROM "Service" WHERE id = ${params.id} FOR SHARE`;
    await assertAutomationWriteAccess(tx! as unknown as typeof prisma, params.id, actor);
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
