import { z } from 'zod';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { buildCursorWhere, formatCursorPagination } from '@/lib/api-v2/pagination';
import { PaginationQuerySchema } from '@/lib/api-v2/validation';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { createIncidentTemplate, incidentTemplateReadWhere, IncidentTemplateInputSchema } from '@/lib/incidents/templates';
import { AppError } from '@/lib/errors';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
  querySchema: PaginationQuerySchema.strict(),
  handler: async ({ actor, pagination }) => {
    const templates = await prisma.incidentTemplate.findMany({
      where: { AND: [incidentTemplateReadWhere(actor.id, actor.role === 'ADMIN'), buildCursorWhere(pagination.cursor)] },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: pagination.limit + 1,
    });
    return formatCursorPagination(templates, pagination.limit);
  },
});

export const POST = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
  querySchema: z.object({}).strict(),
  bodySchema: IncidentTemplateInputSchema,
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ body, actor, apiKey, tx }) => {
    if (body.defaultServiceId) {
      const service = await tx!.service.findFirst({
        where: { AND: [{ id: body.defaultServiceId }, serviceReadWhere(actor)] },
        select: { id: true },
      });
      if (!service) throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Default service not found.' });
    }
    const template = await createIncidentTemplate(tx!, body, actor.id);
    await logV2Audit({
      action: 'incident.template.created', entityType: 'INCIDENT_TEMPLATE', entityId: template.id,
      actorId: actor.id, apiKeyId: apiKey.id, tx,
    });
    return { status: 201, data: template, headers: { ETag: `"${template.revision}"` } };
  },
});
