import 'server-only';

import prisma from '@/lib/prisma';
import { CAPABILITIES, hasCapability } from '@/lib/authorization';
import { incidentReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';

export type AccessScopeMode = 'GLOBAL' | 'SCOPED' | 'NONE';

export type AccessContext = {
  mode: AccessScopeMode;
  canOperate: boolean;
  teamCount: number;
  serviceCount: number;
  incidentCount: number;
};

/** Canonical description of the population the current actor may see. */
export async function resolveAccessContext(actor: AuthorizationActor): Promise<AccessContext> {
  const canOperate = hasCapability(actor.role, CAPABILITIES.OPERATIONS_MANAGE);
  if (hasCapability(actor.role, CAPABILITIES.INCIDENT_READ_ALL)) {
    const [teamCount, serviceCount, incidentCount] = await Promise.all([
      prisma.team.count(),
      prisma.service.count(),
      prisma.incident.count(),
    ]);
    return { mode: 'GLOBAL', canOperate, teamCount, serviceCount, incidentCount };
  }

  const [serviceCount, incidentCount] = await Promise.all([
    prisma.service.count({ where: serviceReadWhere(actor) }),
    prisma.incident.count({ where: incidentReadWhere(actor) }),
  ]);
  const teamCount = actor.teamIds.length;
  return {
    mode: teamCount > 0 || serviceCount > 0 || incidentCount > 0 ? 'SCOPED' : 'NONE',
    canOperate,
    teamCount,
    serviceCount,
    incidentCount,
  };
}
