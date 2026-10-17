import { z } from 'zod';
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
      select: { id: true, automationDraft: { select: { revision: true, snapshot: true } } },
    });
    if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
    const data = {
      serviceId: service.id,
      revision: service.automationDraft?.revision ?? 0,
      snapshot: snapshotSchema.parse(service.automationDraft?.snapshot ?? emptySnapshot),
    };
    return { data, headers: { ...etagHeaders(data.revision), 'Cache-Control': 'no-store' } };
  },
});

/** Verify the actor has write access to the automation configuration for a service.
 *  Used both inside the serializable transaction (handler) and outside it (replayAuthGuard).
 */
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
  replayAuthGuard: async ({ params, actor }) => {
    await assertAutomationWriteAccess(prisma, params.id, actor);
  },
  handler: async ({ req, params, body, actor, apiKey, tx }) => {
    // Lock the service row so team reassignment cannot race draft authorization.
    await tx!.$queryRaw`SELECT id FROM "Service" WHERE id = ${params.id} FOR SHARE`;
    await assertAutomationWriteAccess(tx! as unknown as typeof prisma, params.id, actor);
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
