import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { defineV2Route, logV2Audit } from '@/lib/api-v2';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { postmortemReadWhere } from '@/lib/authorization-filters';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { actionItemInputSchema, getPostmortemActionItems, replacePostmortemActionItems } from '@/lib/postmortems/action-item-commands';
import type { ActionItem } from '@/lib/action-items';

const paramsSchema = z.object({
  id: z.string().trim().min(1).max(100),
  itemId: z.string().trim().min(1).max(200),
}).strict();
const bodySchema = actionItemInputSchema.omit({ id: true }).partial().refine(
  body => Object.keys(body).length > 0, 'At least one action-item field is required.'
);

function toInput(item: ActionItem) {
  return {
    id: item.id, title: item.title, description: item.description,
    ownerId: item.owner ?? null, dueDate: item.dueDate ?? null,
    status: item.status, priority: item.priority,
  };
}

async function parentFor(db: Prisma.TransactionClient, actor: Parameters<typeof postmortemReadWhere>[0], id: string) {
  const parent = await db.postmortem.findFirst({
    where: { AND: [{ OR: [{ id }, { incidentId: id }] }, postmortemReadWhere(actor)] },
    select: { id: true, incidentId: true },
  });
  if (!parent) throw new AppError({ code: 'POSTMORTEM_NOT_FOUND' });
  return parent;
}

const replayAuthGuard = async ({ actor, params, tx }: {
  actor: Parameters<typeof postmortemReadWhere>[0];
  params: z.infer<typeof paramsSchema>;
  tx?: Prisma.TransactionClient;
}) => {
  const parent = await tx!.postmortem.findFirst({
    where: { AND: [{ OR: [{ id: params.id }, { incidentId: params.id }] }, postmortemReadWhere(actor)] },
    select: { id: true },
  });
  if (!parent) throw new AppError({ code: 'POSTMORTEM_NOT_FOUND' });
};

export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE,
  paramsSchema, querySchema: z.object({}).strict(), bodySchema,
  preconditionRequired: true, idempotent: true, idempotencyRequired: true,
  replayAuthGuard,
  handler: async ({ params, body, actor, apiKey, req, tx }) => {
    const parent = await parentFor(tx!, actor, params.id);
    const collection = await getPostmortemActionItems(tx!, parent.id);
    if (!collection.items.some(item => item.id === params.itemId)) {
      throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Corrective action not found.' });
    }
    const items = collection.items.map(item => item.id === params.itemId
      ? { ...toInput(item), ...body } : toInput(item));
    const updated = await replacePostmortemActionItems(tx!, parent.id, requireRevisionIfMatch(req), items);
    await logV2Audit({
      action: 'postmortem.action_item.updated', entityType: 'INCIDENT', entityId: parent.incidentId,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { postmortemId: parent.id, actionItemId: params.itemId, changes: Object.keys(body) }, tx,
    });
    return { data: { postmortemId: parent.id, revision: updated.revision,
      item: updated.items.find(item => item.id === params.itemId) },
      headers: { ...etagHeaders(updated.revision), 'Cache-Control': 'private, no-store' } };
  },
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE,
  paramsSchema, querySchema: z.object({}).strict(),
  preconditionRequired: true, idempotent: true, idempotencyRequired: true,
  replayAuthGuard,
  handler: async ({ params, actor, apiKey, req, tx }) => {
    const parent = await parentFor(tx!, actor, params.id);
    const collection = await getPostmortemActionItems(tx!, parent.id);
    if (!collection.items.some(item => item.id === params.itemId)) {
      throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Corrective action not found.' });
    }
    const items = collection.items.filter(item => item.id !== params.itemId).map(toInput);
    const updated = await replacePostmortemActionItems(tx!, parent.id, requireRevisionIfMatch(req), items);
    await logV2Audit({
      action: 'postmortem.action_item.deleted', entityType: 'INCIDENT', entityId: parent.incidentId,
      actorId: actor.id, apiKeyId: apiKey.id,
      details: { postmortemId: parent.id, actionItemId: params.itemId }, tx,
    });
    return { data: { postmortemId: parent.id, revision: updated.revision, deletedId: params.itemId },
      headers: { ...etagHeaders(updated.revision), 'Cache-Control': 'private, no-store' } };
  },
});
