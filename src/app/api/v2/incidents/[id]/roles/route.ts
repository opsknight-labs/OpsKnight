import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { defineV2Route } from '@/lib/api-v2/endpoint';
import { AUTHORIZATION_ACTIONS } from '@/lib/authorization-policy';
import { incidentReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import { INCIDENT_ROLE_RELATION_SELECT, incidentRoleRelations } from '@/lib/incidents/roles';
import { listIncidentRoles } from '@/lib/incidents/roles-command';

export const GET = defineV2Route({
  action: AUTHORIZATION_ACTIONS.INCIDENT_READ,
  paramsSchema: z.object({ id: z.string().trim().min(1).max(100) }).strict(),
  querySchema: z.object({}).strict(),
  resourceExtractor: async ({ actor, params }) => {
    const incident = await prisma.incident.findFirst({
      where: { AND: [{ id: params.id }, incidentReadWhere(actor)] },
      include: {
        service: { select: { teamId: true } },
        watchers: { select: { userId: true } },
        roleAssignments: INCIDENT_ROLE_RELATION_SELECT,
      },
    });
    if (!incident) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
    return {
      type: 'incident' as const,
      assigneeId: incident.assigneeId,
      assignedTeamId: incident.teamId,
      serviceTeamId: incident.service.teamId,
      visibility: incident.visibility,
      watcherIds: incident.watchers.map(item => item.userId),
      ...incidentRoleRelations(incident.roleAssignments),
    };
  },
  handler: async ({ params }) => {
    const roles = await listIncidentRoles(params.id);
    return {
      data: roles.map(role => ({
        incidentId: params.id,
        roleKey: role.roleKey,
        label: role.label,
        rights: role.rights,
        holder: role.holder
          ? {
              id: role.holder.id,
              name: role.holder.name,
              email: role.holder.email,
              assignedAt: role.holder.assignedAt,
            }
          : null,
      })),
      headers: { 'Cache-Control': 'no-store' },
    };
  },
});
