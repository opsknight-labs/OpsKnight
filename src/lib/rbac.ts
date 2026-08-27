import 'server-only';

import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import type { Role } from '@prisma/client';
import {
  AuthorizationError,
  CAPABILITIES,
  getRoleCapabilities,
  hasCapability,
  type AppRole,
  type Capability,
} from '@/lib/authorization';

export async function getCurrentUser() {
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.email) {
    throw new Error('Unauthorized');
  }
  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      id: true,
      role: true,
      email: true,
      name: true,
      timeZone: true,
      status: true,
      tokenVersion: true,
    },
  });
  if (!user) {
    throw new Error('User not found');
  }
  if (user.status === 'DISABLED') {
    throw new Error('Unauthorized. User is inactive or disabled.');
  }
  if ((user.tokenVersion ?? 0) !== (session.user.tokenVersion ?? 0)) {
    throw new Error('Unauthorized. Session has been revoked.');
  }
  return user;
}

export async function assertAdmin() {
  return assertCapability(CAPABILITIES.ADMIN_MANAGE, 'Unauthorized. Admin access required.');
}

export async function assertAdminOrResponder() {
  return assertCapability(
    CAPABILITIES.OPERATIONS_MANAGE,
    'Unauthorized. Admin or Responder access required.'
  );
}

export async function assertCapability(capability: Capability, message?: string) {
  const user = await getCurrentUser();
  if (!hasCapability(user.role as AppRole, capability)) {
    throw new AuthorizationError(
      message ?? `Unauthorized. Missing required capability: ${capability}.`,
      capability
    );
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
  return assertCapability(
    CAPABILITIES.OPERATIONS_MANAGE,
    'Unauthorized. Responder access or above required.'
  );
}

export async function assertAuditorOrAdmin() {
  return assertCapability(
    CAPABILITIES.AUDIT_READ,
    'Unauthorized. Auditor or Admin access required.'
  );
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
  if (hasCapability(user.role as AppRole, CAPABILITIES.METRICS_READ_ALL)) {
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

export async function assertCanCreateIncidentForService(serviceId: string) {
  const user = await getCurrentUser();
  if (hasCapability(user.role as AppRole, CAPABILITIES.INCIDENT_CREATE_ALL)) return user;
  if (!hasCapability(user.role as AppRole, CAPABILITIES.INCIDENT_CREATE_SCOPED)) {
    throw new AuthorizationError(
      'Unauthorized. Incident creation access required.',
      CAPABILITIES.INCIDENT_CREATE_SCOPED
    );
  }
  const service = await prisma.service.findFirst({
    where: { id: serviceId, team: { members: { some: { userId: user.id } } } },
    select: { id: true },
  });
  if (!service)
    throw new Error('Unauthorized. You can only create incidents for your team services.');
  return user;
}

export async function assertCanAcknowledgeIncident(incidentId: string) {
  const user = await getCurrentUser();
  if (hasCapability(user.role as AppRole, CAPABILITIES.OPERATIONS_MANAGE)) return user;
  if (!hasCapability(user.role as AppRole, CAPABILITIES.INCIDENT_ACKNOWLEDGE_SCOPED)) {
    throw new AuthorizationError(
      'Unauthorized. Incident acknowledgement access required.',
      CAPABILITIES.INCIDENT_ACKNOWLEDGE_SCOPED
    );
  }
  return assertCanViewIncident(incidentId);
}

export async function assertCanAddIncidentNote(incidentId: string) {
  const user = await getCurrentUser();
  if (hasCapability(user.role as AppRole, CAPABILITIES.OPERATIONS_MANAGE)) return user;
  if (!hasCapability(user.role as AppRole, CAPABILITIES.INCIDENT_NOTE_SCOPED)) {
    throw new AuthorizationError(
      'Unauthorized. Incident note access required.',
      CAPABILITIES.INCIDENT_NOTE_SCOPED
    );
  }
  return assertCanViewIncident(incidentId);
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
      capabilities: getRoleCapabilities(user.role as AppRole),
      authenticated: true,
      isAdmin: user.role === 'ADMIN',
      isAuditor: user.role === 'AUDITOR',
      isAdminOrResponder: user.role === 'ADMIN' || user.role === 'RESPONDER',
      isResponderOrAbove: user.role === 'ADMIN' || user.role === 'RESPONDER',
    };
  } catch {
    return {
      id: '',
      // Backward-compatible unauthenticated sentinel. VIEWER is intentionally
      // not an assignable database role and receives no capabilities.
      role: 'VIEWER' as const,
      capabilities: [] as readonly Capability[],
      authenticated: false,
      isAdmin: false,
      isAuditor: false,
      isAdminOrResponder: false,
      isResponderOrAbove: false,
    };
  }
}

/**
 * Check if user can modify an incident
 * Users can modify incidents if:
 * - They are ADMIN (any incident)
 * - They are the assignee
 * - They are a member of the team that owns the service
 */
export async function assertCanModifyIncident(incidentId: string) {
  const user = await getCurrentUser();

  // Only global admins bypass team boundaries.
  if (hasCapability(user.role as AppRole, CAPABILITIES.OPERATIONS_MANAGE)) {
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

  // Only global admins bypass incident visibility and team boundaries.
  if (hasCapability(user.role as AppRole, CAPABILITIES.INCIDENT_READ_ALL)) {
    return user;
  }

  // Check if user has access to this incident
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      assignee: true,
      watchers: { where: { userId: user.id }, select: { id: true } },
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

  if (incident.watchers.length > 0) {
    return user;
  }

  // Private incidents require explicit assignee/watcher access.
  if (
    incident.visibility === 'PUBLIC' &&
    incident.service.team &&
    incident.service.team.members.length > 0
  ) {
    return user;
  }

  throw new Error('Unauthorized. You do not have permission to view this incident.');
}

/**
 * Check if user can modify a service
 */
export async function assertCanModifyService(serviceId: string) {
  const user = await getCurrentUser();

  // Global admins can modify any service. Responders remain scoped to
  // services owned by a team they belong to.
  if (user.role === 'ADMIN') {
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

  if (hasCapability(user.role as AppRole, CAPABILITIES.SCHEDULE_READ_ALL)) {
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
