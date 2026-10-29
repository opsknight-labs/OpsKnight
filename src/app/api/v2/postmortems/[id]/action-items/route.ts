import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { postmortemReadWhere } from '@/lib/authorization-filters';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import {
  actionItemCollectionSchema,
  getPostmortemActionItems,
  replacePostmortemActionItems,
} from '@/lib/postmortems/action-item-commands';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_READ,
  scopedFilter: true,
  rateLimitTier: 'SEARCH_EXPORT',
  paramsSchema,
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    const parent = await prisma.postmortem.findFirst({
      where: {
        AND: [{ OR: [{ id: params.id }, { incidentId: params.id }] }, postmortemReadWhere(actor)],
      },
      select: { id: true },
    });
    if (!parent) throw new AppError({ code: 'POSTMORTEM_NOT_FOUND' });
    const result = await getPostmortemActionItems(prisma, parent.id);
    return {
      data: result,
      headers: { ...etagHeaders(result.revision), 'Cache-Control': 'private, no-store' },
    };
  },
});

export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema: actionItemCollectionSchema,
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ actor, params, tx }) => {
    const parent = await tx!.postmortem.findFirst({
      where: {
        AND: [{ OR: [{ id: params.id }, { incidentId: params.id }] }, postmortemReadWhere(actor)],
      },
      select: { id: true },
    });
    if (!parent) throw new AppError({ code: 'POSTMORTEM_NOT_FOUND' });
  },
  handler: async ({ params, body, actor, apiKey, req, tx }) => {
    const parent = await tx!.postmortem.findFirst({
      where: {
        AND: [{ OR: [{ id: params.id }, { incidentId: params.id }] }, postmortemReadWhere(actor)],
      },
      select: { id: true, incidentId: true },
    });
    if (!parent) throw new AppError({ code: 'POSTMORTEM_NOT_FOUND' });
    const result = await replacePostmortemActionItems(
      tx!,
      parent.id,
      requireRevisionIfMatch(req),
      body.items
    );
    await logV2Audit({
      action: 'postmortem.action_items.replaced',
      entityType: 'INCIDENT',
      entityId: parent.incidentId,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { postmortemId: parent.id, itemCount: result.items.length },
      tx,
    });
    return {
      data: result,
      headers: { ...etagHeaders(result.revision), 'Cache-Control': 'private, no-store' },
    };
  },
});
