import 'server-only';

import prisma from '@/lib/prisma';
import { serviceReadWhere, teamReadWhere } from '@/lib/authorization-filters';
import type { AuthorizationActor } from '@/lib/authorization-policy';

/** Picker options for the business-service form, scoped to what the actor can see. */
export async function loadBusinessServiceFormOptions(actor: AuthorizationActor) {
  const [services, teams, users] = await Promise.all([
    prisma.service.findMany({
      where: serviceReadWhere(actor),
      orderBy: { name: 'asc' },
      select: { id: true, name: true, team: { select: { name: true } } },
    }),
    prisma.team.findMany({
      where: teamReadWhere(actor),
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, email: true },
    }),
  ]);
  return {
    services: services.map(service => ({
      id: service.id,
      name: service.name,
      hint: service.team?.name ?? null,
    })),
    teams,
    users: users.map(user => ({ id: user.id, name: user.name, hint: user.email })),
  };
}
