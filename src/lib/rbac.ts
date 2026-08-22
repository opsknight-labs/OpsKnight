import 'server-only';

import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import type { Role } from '@prisma/client';

export async function getCurrentUser() {
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.email) {
    throw new Error('Unauthorized');
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true, role: true, email: true, name: true, timeZone: true, status: true },
  });
  if (!user) {
    throw new Error('User not found');
  }
  if (user.status === 'DISABLED') {
    throw new Error('Unauthorized. User is inactive or disabled.');
  }
  return user;
}

export async function assertAdmin() {
  const user = await getCurrentUser();
  if (user.role !== 'ADMIN') {
    throw new Error('Unauthorized. Admin access required.');
  }
  return user;
}

export async function assertAdminOrResponder() {
  const user = await getCurrentUser();
  if (user.role !== 'ADMIN' && user.role !== 'RESPONDER') {
    throw new Error('Unauthorized. Admin or Responder access required.');
  }
  return user;
}

export async function assertAdminOrTeamOwner(teamId: string) {
  const user = await getCurrentUser();
  if (user.role === 'ADMIN') {
    return user;
  }

  const membership = await prisma.teamMember.findFirst({
    where: {
      teamId,
      userId: user.id,
      role: 'OWNER',
    },
    select: { id: true },
  });

  if (!membership) {
    throw new Error('Unauthorized. Admin or Team Owner access required.');
  }

  return user;
}

export async function assertResponderOrAbove() {
  const user = await getCurrentUser();
  if (user.role !== 'ADMIN' && user.role !== 'RESPONDER') {
    throw new Error('Unauthorized. Responder access or above required.');
  }
  return user;
}

export async function assertNotSelf(currentUserId: string, targetUserId: string, action: string) {
  if (currentUserId === targetUserId) {
    throw new Error(`You cannot ${action} your own account.`);
  }
}

/**
 * Verifies the current user can read metrics scoped to the given service /
 * team filter. ADMIN and RESPONDER roles see everything (consistent with
 * incident-modify semantics elsewhere in this file). For regular USERs, the
 * service must belong to a team they are a member of, and any teamId filter
 * must be a team they are a member of.
 *
 * Pass a single id or an array; an empty/undefined filter means "no scope
 * constraint" and is allowed only when the user has global read.
 *
 * Throws on denial — callers should let it surface as 403 to clients.
 */
export async function assertCanReadServiceMetrics(opts: {
  serviceId?: string | string[] | null;
  teamId?: string | string[] | null;
}) {
  const user = await getCurrentUser();

  // ADMIN/RESPONDER bypass — they have global read for ops dashboards.
  if (user.role === 'ADMIN' || user.role === 'RESPONDER') {
    return user;
  }

  const serviceIds = Array.isArray(opts.serviceId)
    ? opts.serviceId
    : opts.serviceId
      ? [opts.serviceId]
      : [];
  const teamIds = Array.isArray(opts.teamId) ? opts.teamId : opts.teamId ? [opts.teamId] : [];

  // No scope constraint and not admin/responder → deny. Forces callers to
  // pass an explicit scope rather than reading global metrics by omission.
  if (serviceIds.length === 0 && teamIds.length === 0) {
    throw new Error('Unauthorized. Specify serviceId or teamId to view metrics.');
  }

  // Collect the teams the user belongs to once.
  const memberships = await prisma.teamMember.findMany({
    where: { userId: user.id },
    select: { teamId: true },
  });
  const userTeamIds = new Set(memberships.map(m => m.teamId));

  // Every team in the filter must be one the user is in.
  for (const teamId of teamIds) {
    if (!userTeamIds.has(teamId)) {
      throw new Error('Unauthorized. You are not a member of the requested team.');
    }
  }

  // Every service must be owned by a team the user is in.
  if (serviceIds.length > 0) {
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, teamId: true },
    });
    if (services.length !== serviceIds.length) {
      throw new Error('One or more services not found.');
    }
    for (const s of services) {
      if (!s.teamId || !userTeamIds.has(s.teamId)) {
        throw new Error('Unauthorized. Service belongs to a team you are not in.');
      }
    }
  }

  return user;
}

export async function getUserPermissions() {
  try {
    const user = await getCurrentUser();
    const { logger } = await import('@/lib/logger');
    logger.warn('[RBAC] Resolved user permissions', {
      id: user.id,
      role: user.role,
    });
    return {
      id: user.id,
      role: user.role as Role,
      authenticated: true,
      isAdmin: user.role === 'ADMIN',
      isAdminOrResponder: user.role === 'ADMIN' || user.role === 'RESPONDER',
      isResponderOrAbove: user.role === 'ADMIN' || user.role === 'RESPONDER',
    };
  } catch {
    return {
      id: '',
      role: 'VIEWER' as Role,
      authenticated: false,
      isAdmin: false,
      isAdminOrResponder: false,
      isResponderOrAbove: false,
    };
  }
}

/**
 * Check if user can modify an incident
 * Users can modify incidents if:
 * - They are ADMIN or RESPONDER (any incident)
 * - They are the assignee
 * - They are a member of the team that owns the service
 */
export async function assertCanModifyIncident(incidentId: string) {
  const user = await getCurrentUser();

  // Admins and responders can modify any incident
  if (user.role === 'ADMIN' || user.role === 'RESPONDER') {
    return user;
  }

  // Check if user has access to this incident
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      assignee: true,
      service: {
        include: {
          team: {
            include: {
              members: {
                where: { userId: user.id },
              },
            },
          },
        },
      },
    },
  });

  if (!incident) {
    throw new Error('Incident not found');
  }

  // Check if user is assignee
  if (incident.assigneeId === user.id) {
    return user;
  }

  // Check if user is team member
  if (incident.service.team && incident.service.team.members.length > 0) {
    return user;
  }

  throw new Error('Unauthorized. You do not have permission to modify this incident.');
}

/**
 * Check if user can view an incident
 */
export async function assertCanViewIncident(incidentId: string) {
  const user = await getCurrentUser();

  // Admins and responders can view any incident
  if (user.role === 'ADMIN' || user.role === 'RESPONDER') {
    return user;
  }

  // Check if user has access to this incident
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      assignee: true,
      service: {
        include: {
          team: {
            include: {
              members: {
                where: { userId: user.id },
              },
            },
          },
        },
      },
    },
  });

  if (!incident) {
    throw new Error('Incident not found');
  }

  // Check if user is assignee
  if (incident.assigneeId === user.id) {
    return user;
  }

  // Check if user is team member
  if (incident.service.team && incident.service.team.members.length > 0) {
    return user;
  }

  throw new Error('Unauthorized. You do not have permission to view this incident.');
}

/**
 * Check if user can modify a service
 */
export async function assertCanModifyService(serviceId: string) {
  const user = await getCurrentUser();

  // Admins and responders can modify any service
  if (user.role === 'ADMIN' || user.role === 'RESPONDER') {
    return user;
  }

  // Check if user is team member of the service's team
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: {
      team: {
        include: {
          members: {
            where: { userId: user.id },
          },
        },
      },
    },
  });

  if (!service) {
    throw new Error('Service not found');
  }

  // Check if user is team member
  if (service.team && service.team.members.length > 0) {
    return user;
  }

  throw new Error('Unauthorized. You do not have permission to modify this service.');
}

/**
 * Check if user can view a schedule
 * Users can view schedules if:
 * - They are ADMIN or RESPONDER
 * - They are assigned to a layer in the schedule
 * - They are referenced in an override (as user or replacement)
 */
export async function assertCanViewSchedule(scheduleId: string) {
  const user = await getCurrentUser();

  if (user.role === 'ADMIN' || user.role === 'RESPONDER') {
    return user;
  }

  const schedule = await prisma.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true,
      layers: {
        select: {
          users: {
            where: { userId: user.id },
            select: { id: true },
          },
        },
      },
      overrides: {
        where: {
          OR: [{ userId: user.id }, { replacesUserId: user.id }],
        },
        select: { id: true },
      },
    },
  });

  if (!schedule) {
    throw new Error('Schedule not found');
  }

  const hasLayerAccess = schedule.layers.some(layer => layer.users.length > 0);
  if (hasLayerAccess || schedule.overrides.length > 0) {
    return user;
  }

  throw new Error('Unauthorized. You do not have permission to view this schedule.');
}
