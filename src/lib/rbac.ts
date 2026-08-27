import 'server-only';

import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import type { Role } from '@prisma/client';
import { AppError } from '@/lib/errors';
import {
  AuthorizationError,
  CAPABILITIES,
  getRoleCapabilities,
  hasCapability,
  type AppRole,
  type Capability,
} from '@/lib/authorization';

function appError(
  code:
    | 'AUTHENTICATION_REQUIRED'
    | 'SESSION_REVOKED'
    | 'USER_DISABLED'
    | 'AUTHORIZATION_DENIED'
    | 'INCIDENT_NOT_FOUND'
    | 'INCIDENT_ACCESS_DENIED'
    | 'INCIDENT_MODIFY_DENIED'
    | 'INCIDENT_CREATE_SERVICE_ACCESS_DENIED'
    | 'SERVICE_NOT_FOUND'
    | 'SERVICE_ACCESS_DENIED'
    | 'SCHEDULE_NOT_FOUND'
    | 'SCHEDULE_ACCESS_DENIED',
  userMessage: string,
  details?: Record<string, unknown>
) {
  return new AppError({ code, userMessage, details });
}

export async function getCurrentUser() {
  const session = await getServerSession(await getAuthOptions());
  if (!session?.user?.email) {
    throw appError('AUTHENTICATION_REQUIRED', 'Unauthorized');
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
    throw appError('AUTHENTICATION_REQUIRED', 'User not found');
  }
  if (user.status === 'DISABLED') {
    throw appError('USER_DISABLED', 'Unauthorized. User is inactive or disabled.', { userId: user.id });
  }
  if ((user.tokenVersion ?? 0) !== (session.user.tokenVersion ?? 0)) {
    throw appError('SESSION_REVOKED', 'Unauthorized. Session has been revoked.', { userId: user.id });
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
  if (user.role === 'ADMIN') return user;

  const membership = await prisma.teamMember.findFirst({
    where: { teamId, userId: user.id, role: 'OWNER' },
    select: { id: true },
  });

  if (!membership) {
    throw appError('AUTHORIZATION_DENIED', 'Unauthorized. Admin or Team Owner access required.', {
      teamId,
      userId: user.id,
    });
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
    throw appError('AUTHORIZATION_DENIED', `You cannot ${action} your own account.`, {
      currentUserId,
      targetUserId,
      action,
    });
  }
}

export async function assertCanReadServiceMetrics(opts: {
  serviceId?: string | string[] | null;
  teamId?: string | string[] | null;
}) {
  const user = await getCurrentUser();
  if (hasCapability(user.role as AppRole, CAPABILITIES.METRICS_READ_ALL)) return user;

  const serviceIds = Array.isArray(opts.serviceId)
    ? opts.serviceId
    : opts.serviceId
      ? [opts.serviceId]
      : [];
  const teamIds = Array.isArray(opts.teamId) ? opts.teamId : opts.teamId ? [opts.teamId] : [];

  if (serviceIds.length === 0 && teamIds.length === 0) {
    throw appError('AUTHORIZATION_DENIED', 'Unauthorized. Specify serviceId or teamId to view metrics.');
  }

  const memberships = await prisma.teamMember.findMany({
    where: { userId: user.id },
    select: { teamId: true },
  });
  const userTeamIds = new Set(memberships.map(m => m.teamId));

  for (const teamId of teamIds) {
    if (!userTeamIds.has(teamId)) {
      throw appError('AUTHORIZATION_DENIED', 'Unauthorized. You are not a member of the requested team.', {
        teamId,
        userId: user.id,
      });
    }
  }

  if (serviceIds.length > 0) {
    const services = await prisma.service.findMany({
      where: { id: { in: serviceIds } },
      select: { id: true, teamId: true },
    });
    if (services.length !== serviceIds.length) {
      throw appError('SERVICE_NOT_FOUND', 'One or more services not found.');
    }
    for (const service of services) {
      if (!service.teamId || !userTeamIds.has(service.teamId)) {
        throw appError('SERVICE_ACCESS_DENIED', 'Unauthorized. Service belongs to a team you are not in.', {
          serviceId: service.id,
          userId: user.id,
        });
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
  if (!service) {
    throw appError(
      'INCIDENT_CREATE_SERVICE_ACCESS_DENIED',
      'Unauthorized. You can only create incidents for your team services.',
      { serviceId, userId: user.id }
    );
  }
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
    logger.warn('[RBAC] Resolved user permissions', { id: user.id, role: user.role });
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

export async function assertCanModifyIncident(incidentId: string) {
  const user = await getCurrentUser();
  if (hasCapability(user.role as AppRole, CAPABILITIES.OPERATIONS_MANAGE)) return user;

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      assignee: true,
      service: {
        include: {
          team: { include: { members: { where: { userId: user.id } } } },
        },
      },
    },
  });

  if (!incident) {
    throw appError('INCIDENT_NOT_FOUND', 'Incident not found', { incidentId });
  }
  if (incident.assigneeId === user.id) return user;
  if (incident.service.team && incident.service.team.members.length > 0) return user;

  throw appError(
    'INCIDENT_MODIFY_DENIED',
    'Unauthorized. You do not have permission to modify this incident.',
    { incidentId, userId: user.id }
  );
}

export async function assertCanViewIncident(incidentId: string) {
  const user = await getCurrentUser();
  if (hasCapability(user.role as AppRole, CAPABILITIES.INCIDENT_READ_ALL)) return user;

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      assignee: true,
      watchers: { where: { userId: user.id }, select: { id: true } },
      service: {
        include: {
          team: { include: { members: { where: { userId: user.id } } } },
        },
      },
    },
  });

  if (!incident) {
    throw appError('INCIDENT_NOT_FOUND', 'Incident not found', { incidentId });
  }
  if (incident.assigneeId === user.id) return user;
  if (incident.watchers.length > 0) return user;
  if (
    incident.visibility === 'PUBLIC' &&
    incident.service.team &&
    incident.service.team.members.length > 0
  ) {
    return user;
  }

  throw appError(
    'INCIDENT_ACCESS_DENIED',
    'Unauthorized. You do not have permission to view this incident.',
    { incidentId, userId: user.id }
  );
}

export async function assertCanModifyService(serviceId: string) {
  const user = await getCurrentUser();
  if (user.role === 'ADMIN') return user;

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: {
      team: { include: { members: { where: { userId: user.id } } } },
    },
  });

  if (!service) {
    throw appError('SERVICE_NOT_FOUND', 'Service not found', { serviceId });
  }
  if (service.team && service.team.members.length > 0) return user;

  throw appError(
    'SERVICE_ACCESS_DENIED',
    'Unauthorized. You do not have permission to modify this service.',
    { serviceId, userId: user.id }
  );
}

export async function assertCanViewSchedule(scheduleId: string) {
  const user = await getCurrentUser();
  if (hasCapability(user.role as AppRole, CAPABILITIES.SCHEDULE_READ_ALL)) return user;

  const schedule = await prisma.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: {
      id: true,
      layers: {
        select: {
          users: { where: { userId: user.id }, select: { id: true } },
        },
      },
      overrides: {
        where: { OR: [{ userId: user.id }, { replacesUserId: user.id }] },
        select: { id: true },
      },
    },
  });

  if (!schedule) {
    throw appError('SCHEDULE_NOT_FOUND', 'Schedule not found', { scheduleId });
  }

  const hasLayerAccess = schedule.layers.some(layer => layer.users.length > 0);
  if (hasLayerAccess || schedule.overrides.length > 0) return user;

  throw appError(
    'SCHEDULE_ACCESS_DENIED',
    'Unauthorized. You do not have permission to view this schedule.',
    { scheduleId, userId: user.id }
  );
}
