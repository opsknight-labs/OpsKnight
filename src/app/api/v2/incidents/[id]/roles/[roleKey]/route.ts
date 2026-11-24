import { z } from 'zod/v3';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { logV2Audit } from '@/lib/api-v2/audit';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import { INCIDENT_ROLE_KEYS } from '@/lib/incidents/roles';
import { assertCanChangeIncidentRole } from '@/lib/incidents/role-access';
import { assignIncidentRoleCommand } from '@/lib/incidents/roles-command';

const paramsSchema = z
  .object({ id: z.string().trim().min(1).max(100), roleKey: z.enum(INCIDENT_ROLE_KEYS) })
  .strict();

// Operators may take a role, the commander may hand roles out and managers may set any role;
// the relationship check runs in the handler, so the route gate is the operator action.
export const PUT = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  bodySchema: z.object({ userId: z.string().trim().min(1).max(100) }).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, body, actor, apiKey, tx }) => {
    const incident = await tx!.incident.findFirst({
      where: { AND: [{ id: params.id }, incidentReadWhere(actor)] },
      select: { id: true },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    await assertCanChangeIncidentRole(actor, params.id, params.roleKey, body.userId);
    const result = await assignIncidentRoleCommand(
      {
        incidentId: params.id,
        roleKey: params.roleKey,
        userId: body.userId,
        actor: { id: actor.id },
        source: 'API',
      },
      tx
    );
    await logV2Audit({
      action: 'incident.role.assigned',
      entityType: 'INCIDENT',
      entityId: params.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { roleKey: params.roleKey, role: params.roleKey, userId: body.userId },
      tx,
    });
    return { data: result };
  },
});

export const DELETE = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE,
  paramsSchema,
  querySchema: z.object({}).strict(),
  idempotent: true,
  idempotencyRequired: true,
  handler: async ({ params, actor, apiKey, tx }) => {
    const incident = await tx!.incident.findFirst({
      where: { AND: [{ id: params.id }, incidentReadWhere(actor)] },
      select: { id: true },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    await assertCanChangeIncidentRole(actor, params.id, params.roleKey, null);
    const result = await assignIncidentRoleCommand(
      {
        incidentId: params.id,
        roleKey: params.roleKey,
        userId: null,
        actor: { id: actor.id },
        source: 'API',
      },
      tx
    );
    await logV2Audit({
      action: 'incident.role.cleared',
      entityType: 'INCIDENT',
      entityId: params.id,
      actorId: actor.id,
      apiKeyId: apiKey.id,
      details: { roleKey: params.roleKey, role: params.roleKey },
      tx,
    });
    return { data: result };
  },
});
