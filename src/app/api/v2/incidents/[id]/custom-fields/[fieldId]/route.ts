import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { setIncidentCustomField } from '@/lib/incidents/custom-fields';
import { AppError } from '@/lib/errors';

const paramsSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    fieldId: z.string().trim().min(1).max(100),
  })
  .strict();

const valueSchema = z.union([z.string().max(10000), z.number().finite(), z.boolean(), z.null()]);

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
  paramsSchema,
  querySchema: z.object({}).strict(),
  handler: async ({ params, actor }) => {
    const incident = await prisma.incident.findFirst({
      where: { AND: [{ id: params.id }, incidentReadWhere(actor)] },
      select: { id: true },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    const field = await prisma.customFieldValue.findUnique({
      where: { incidentId_customFieldId: { incidentId: params.id, customFieldId: params.fieldId } },
      include: { customField: { select: { name: true, key: true, type: true } } },
    });
    if (!field) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
    return { data: field };
  },
});

export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ value: valueSchema }).strict(),
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
    const result = await setIncidentCustomField(tx!, params.id, params.fieldId, body.value);
    if (result.changed) {
      await logV2Audit({
        action: 'incident.custom_field.updated',
        entityType: 'INCIDENT',
        entityId: params.id,
        actorId: actor.id,
        apiKeyId: apiKey.id,
        details: { customFieldId: params.fieldId },
        tx,
      });
    }
    return { data: result };
  },
});
