import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { etagHeaders, requireRevisionIfMatch } from '@/lib/api-v2/concurrency';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { serviceReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import {
  assertIncidentTemplateOwner,
  deleteIncidentTemplate,
  incidentTemplateReadWhere,
  IncidentTemplateInputSchema,
  updateIncidentTemplate,
} from '@/lib/incidents/templates';

const paramsSchema = z.object({ templateId: z.string().trim().min(1).max(100) }).strict();

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
  paramsSchema,
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    const template = await prisma.incidentTemplate.findFirst({
      where: {
        AND: [
          { id: params.templateId },
          incidentTemplateReadWhere(actor.id, actor.role === 'ADMIN'),
        ],
      },
    });
    if (!template)
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: 'Incident template not found.',
      });
    return { data: template, headers: etagHeaders(template.revision) };
  },
});

export const PATCH = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema: IncidentTemplateInputSchema.partial().refine(value => Object.keys(value).length > 0),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, actor, tx }) => {
    await assertIncidentTemplateOwner(tx!, params.templateId, actor.id, actor.role === 'ADMIN');
  },
  handler: async ({ req, params, body, actor, apiKey, tx }) => {
    if (body.defaultServiceId) {
      const service = await tx!.service.findFirst({
        where: { AND: [{ id: body.defaultServiceId }, serviceReadWhere(actor)] },
        select: { id: true },
      });
      if (!service)
        throw new AppError({
          code: 'RESOURCE_NOT_FOUND',
          userMessage: 'Default service not found.',
        });
    }
    const updated = await updateIncidentTemplate(
      tx!,
      params.templateId,
      requireRevisionIfMatch(req),
      body,
      actor.id,
      actor.role === 'ADMIN'
    );
    await logV2Audit({
      action: 'incident.template.updated',
      entityType: 'INCIDENT_TEMPLATE',
      entityId: updated.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      tx,
    });
    return { data: updated, headers: etagHeaders(updated.revision) };
  },
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  preconditionRequired: true,
  idempotent: true,
  idempotencyRequired: true,
  replayAuthGuard: async ({ params, actor, tx }) => {
    const existing = await tx!.incidentTemplate.findUnique({
      where: { id: params.templateId },
      select: { id: true },
    });
    if (existing)
      await assertIncidentTemplateOwner(tx!, params.templateId, actor.id, actor.role === 'ADMIN');
  },
  handler: async ({ req, params, actor, apiKey, tx }) => {
    const deleted = await deleteIncidentTemplate(
      tx!,
      params.templateId,
      actor.id,
      actor.role === 'ADMIN',
      requireRevisionIfMatch(req)
    );
    await logV2Audit({
      action: 'incident.template.deleted',
      entityType: 'INCIDENT_TEMPLATE',
      entityId: params.templateId,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      tx,
    });
    return { data: deleted };
  },
});
