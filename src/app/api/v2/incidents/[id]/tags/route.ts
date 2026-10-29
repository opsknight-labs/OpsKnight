import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { addIncidentTag, IncidentTagNameSchema } from '@/lib/incidents/tags';
import { AppError } from '@/lib/errors';

const paramsSchema = z.object({ id: z.string().trim().min(1).max(100) }).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
  paramsSchema,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ params, actor, pagination }) => {
    const incident = await prisma.incident.findFirst({
      where: { AND: [{ id: params.id }, incidentReadWhere(actor)] },
      select: { id: true },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    const tags = await prisma.incidentTag.findMany({
      where: { AND: [{ incidentId: params.id }, buildCursorWhere(pagination.cursor)] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
      select: {
        id: true,
        incidentId: true,
        tagId: true,
        createdAt: true,
        tag: { select: { name: true, color: true } },
      },
    });
    return formatCursorPagination(tags, pagination.limit);
  },
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ name: IncidentTagNameSchema }).strict(),
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, actor, tx }) => {
    const incident = await tx!.incident.findFirst({
      where: { AND: [{ id: params.id }, incidentReadWhere(actor)] },
      select: { id: true },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
  },
  handler: async ({ params, body, actor, apiKey, tx }) => {
    const incident = await tx!.incident.findFirst({
      where: { AND: [{ id: params.id }, incidentReadWhere(actor)] },
      select: { id: true },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    const result = await addIncidentTag(params.id, body.name, undefined, tx);
    if (result.changed) {
      await logV2Audit({
        action: 'incident.tag.added',
        entityType: 'INCIDENT',
        entityId: params.id,
        actorId: actor.id,
        apiKeyId: apiKey.id,
        details: { tagId: result.tag.id },
        tx,
      });
    }
    return {
      data: {
        id: result.tag.id,
        name: result.tag.name,
        color: result.tag.color,
        incidentId: params.id,
        added: result.changed,
      },
    };
  },
});
