import 'server-only';

import prisma from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { getAuthOptions } from '@/lib/auth';
import type { Prisma, Role } from '@prisma/client';
import { AppError } from '@/lib/errors';
import {
  AuthorizationError,
  CAPABILITIES,
  capabilitiesOf,
  isAppRole,
  type Capability,
} from '@/lib/authorization';
import { resolveUserActor } from '@/lib/authorization-actors';
import { scheduleReadWhere, serviceReadWhere } from '@/lib/authorization-filters';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationAction,
} from '@/lib/authorization-policy';
import { effectiveAccessSelect, resolveEffectiveAccess } from '@/lib/access/effective';
import { getAccessControlSettings } from '@/lib/access/settings';
import { describeRequirement } from '@/lib/access/catalog';
import { resolveIncidentResourceForActor } from '@/lib/access/incident-relations';
import {
  deriveScheduleUICapabilities,
  type ScheduleUICapabilities,
} from '@/lib/schedules/capabilities';

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
  if (!session?.user?.id && !session?.user?.email) {
    throw appError('AUTHENTICATION_REQUIRED', 'Unauthorized');
  }
  const settings = await getAccessControlSettings();
  const record = await prisma.user.findUnique({
    where: session.user.id ? { id: session.user.id } : { email: session.user.email! },
    select: {
      id: true,
      role: true,
      email: true,
      name: true,
      timeZone: true,
      status: true,
      tokenVersion: true,
      invitationGeneration: true,
      gender: true,
      department: true,
      jobTitle: true,
      avatarUrl: true,
      phoneNumber: true,
      emailNotificationsEnabled: true,
      smsNotificationsEnabled: true,
      voiceNotificationsEnabled: true,
      pushNotificationsEnabled: true,
      whatsappNotificationsEnabled: true,
      ...effectiveAccessSelect(),
    },
  });
  if (!record) {
    throw appError('AUTHENTICATION_REQUIRED', 'User not found');
  }
  const { customRole, accessGrants, ...stored } = record;
  const access = isAppRole(stored.role)
    ? resolveEffectiveAccess({ role: stored.role, customRole, accessGrants }, settings)
    : null;
  // `role` is the effective role (base role raised by any active temporary grant) so every
  // existing role check honours just-in-time access; `baseRole` is the assigned role.
  const user = {
    ...stored,
    role: (access?.role ?? stored.role) as Role,
    baseRole: stored.role,
    capabilities: access ? [...access.capabilities] : ([] as Capability[]),
    customRoleName: access?.customRole?.name ?? null,
    elevatedIncidentIds: access?.elevatedIncidentIds ?? [],
  };
  if (user.status === 'DISABLED') {
    throw appError('USER_DISABLED', 'Unauthorized. User is inactive or disabled.', {
      userId: user.id,
    });
  }
  if ((user.tokenVersion ?? 0) !== (session.user.tokenVersion ?? 0)) {
    throw appError('SESSION_REVOKED', 'Unauthorized. Session has been revoked.', {
      userId: user.id,
    });
  }

  const sessionId = session.user?.sessionId || session.sessionId;
  if (sessionId) {
    void (async () => {
      let userAgent: string | null = null;
      try {
        const { headers } = await import('next/headers');
        const headerStore = await headers();
        userAgent = headerStore.get('user-agent');
      } catch {
        // Ignored outside request context
      }
      const { touchAuthenticatedSession } = await import('@/lib/session-registry');
      await touchAuthenticatedSession({
        userId: user.id,
        sessionId,
        userAgent,
      });
    })();
  }

  return user;
}

export { capabilitiesOf };

export async function getCurrentAuthorizationActor() {
  const user = await getCurrentUser();
  const actor = await resolveUserActor(user.id);
  if (!actor || !isAppRole(user.role) || actor.status !== 'ACTIVE') {
    throw appError('AUTHORIZATION_DENIED', 'Unauthorized. Invalid application role.');
  }
  return actor;
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
  if (!capabilitiesOf(user).includes(capability)) {
    const requirement = describeRequirement(capability);
    void recordActionDenial(user.id, [capability], 'MISSING_CAPABILITY');
    throw new AuthorizationError(
      message ?? `You don't have permission to ${requirement.capabilityText.toLowerCase()}.`,
      capability
    );
  }
  return user;
}

/** Audits a denied server action/API call; deduplicated and never throws. */
async function recordActionDenial(
  userId: string,
  requiredCapabilities: readonly Capability[],
  reason: string,
  resource?: { type: string; id?: string | null }
) {
  try {
    const { recordAccessDenied, currentPathname } = await import('@/lib/access/server');
    await recordAccessDenied({
      userId,
      path: await currentPathname(),
      requiredCapabilities,
      reason,
      resource,
      channel: 'ACTION',
    });
  } catch {
    // Outside a request (scripts, workers): nothing to attribute the denial to.
  }
}

export async function assertCanListUsers() {
  return assertCapability(
    CAPABILITIES.USER_READ_ALL,
    'Unauthorized. Organization-wide user directory access required.'
  );
}

export async function assertCanViewUser(_userId: string) {
  return assertCanListUsers();
}

export async function assertCanListPolicies() {
  return assertCapability(
    CAPABILITIES.POLICY_READ_ALL,
    'Unauthorized. Escalation policy access required.'
  );
}

export async function assertCanViewPolicy(_policyId: string) {
  return assertCanListPolicies();
}

/**
 * Team management (members, settings, lead, services): organization admins, team owners and
 * team admins. Changes that touch ownership are further limited to owners inside
 * `@/lib/teams/administration`.
 */
export async function assertTeamManager(teamId: string) {
  const user = await getCurrentUser();
  if (capabilitiesOf(user).includes(CAPABILITIES.ADMIN_MANAGE)) return user;
  if (!capabilitiesOf(user).includes(CAPABILITIES.TEAM_ADMINISTER_SCOPED)) {
    void recordActionDenial(user.id, [CAPABILITIES.TEAM_ADMINISTER_SCOPED], 'MISSING_CAPABILITY', {
      type: 'team',
      id: teamId,
    });
    throw appError('AUTHORIZATION_DENIED', 'Read-only users cannot manage teams.', {
      teamId,
      userId: user.id,
    });
  }

  const membership = await prisma.teamMember.findFirst({
    where: { teamId, userId: user.id, role: { in: ['OWNER', 'ADMIN'] } },
    select: { id: true },
  });

  if (!membership) {
    void recordActionDenial(
      user.id,
      [CAPABILITIES.TEAM_ADMINISTER_SCOPED],
      'RESOURCE_OUT_OF_SCOPE',
      {
        type: 'team',
        id: teamId,
      }
    );
    throw appError(
      'AUTHORIZATION_DENIED',
      'Only team owners, team admins and organization admins can manage this team.',
      { teamId, userId: user.id }
    );
  }
  return user;
}

/** @deprecated Use `assertTeamManager`; team admins are now managers too. */
export const assertAdminOrTeamOwner = assertTeamManager;

export async function getViewableTeamWhere(): Promise<Prisma.TeamWhereInput> {
  const user = await getCurrentUser();
  if (capabilitiesOf(user).includes(CAPABILITIES.SERVICE_READ_ALL)) return {};
  return { members: { some: { userId: user.id } } };
}

export async function assertCanViewTeam(teamId: string) {
  const team = await prisma.team.findFirst({
    where: { id: teamId, ...(await getViewableTeamWhere()) },
    select: { id: true },
  });
  if (team) return getCurrentUser();
  throw appError(
    'AUTHORIZATION_DENIED',
    'Unauthorized. You do not have permission to view this team.',
    {
      teamId,
    }
  );
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

export function assertNotSelf(currentUserId: string, targetUserId: string, action: string) {
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
  if (capabilitiesOf(user).includes(CAPABILITIES.METRICS_READ_ALL)) return user;

  const serviceIds = Array.isArray(opts.serviceId)
    ? opts.serviceId
    : opts.serviceId
      ? [opts.serviceId]
      : [];
  const teamIds = Array.isArray(opts.teamId) ? opts.teamId : opts.teamId ? [opts.teamId] : [];

  if (serviceIds.length === 0 && teamIds.length === 0) {
    throw appError(
      'AUTHORIZATION_DENIED',
      'Unauthorized. Specify serviceId or teamId to view metrics.'
    );
  }

  const memberships = await prisma.teamMember.findMany({
    where: { userId: user.id },
    select: { teamId: true },
  });
  const userTeamIds = new Set(memberships.map(m => m.teamId));

  for (const teamId of teamIds) {
    if (!userTeamIds.has(teamId)) {
      throw appError(
        'AUTHORIZATION_DENIED',
        'Unauthorized. You are not a member of the requested team.',
        {
          teamId,
          userId: user.id,
        }
      );
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
        throw appError(
          'SERVICE_ACCESS_DENIED',
          'Unauthorized. Service belongs to a team you are not in.',
          {
            serviceId: service.id,
            userId: user.id,
          }
        );
      }
    }
  }

  return user;
}

export async function assertCanCreateIncidentForService(serviceId: string) {
  const user = await assertCapability(
    CAPABILITIES.INCIDENT_CREATE_ALL,
    'Unauthorized. Incident creation requires Responder or Admin access.'
  );
  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    select: { id: true },
  });
  if (!service) throw appError('SERVICE_NOT_FOUND', 'Service not found', { serviceId });
  return user;
}

export async function assertCanAcknowledgeIncident(incidentId: string) {
  return assertIncidentOperator(
    incidentId,
    'acknowledge',
    AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE
  );
}

export async function assertCanAddIncidentNote(incidentId: string) {
  return assertIncidentOperator(incidentId, 'add notes to', AUTHORIZATION_ACTIONS.INCIDENT_NOTE);
}

type IncidentOperatorAction =
  | typeof AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE
  | typeof AUTHORIZATION_ACTIONS.INCIDENT_NOTE
  | typeof AUTHORIZATION_ACTIONS.INCIDENT_ESCALATE
  | typeof AUTHORIZATION_ACTIONS.INCIDENT_RESOLVE
  | typeof AUTHORIZATION_ACTIONS.INCIDENT_MANAGE;

/**
 * Incident operations. Responders and Admins may operate any incident. Everyone else may
 * acknowledge, add notes, escalate and resolve incidents they are assigned to, are paged for,
 * or that belong to one of their teams. Other changes (urgency, reassignment, meetings, war
 * rooms) stay with Responders and Admins.
 */
async function assertIncidentOperator(
  incidentId: string,
  operation: string,
  action: IncidentOperatorAction = AUTHORIZATION_ACTIONS.INCIDENT_MANAGE
) {
  const user = await getCurrentUser();
  const actor = await resolveUserActor(user.id);
  const roleOnlyMessage = `Unauthorized. Only Responders and Admins may ${operation} incidents.`;
  if (!actor) throw new AuthorizationError(roleOnlyMessage, CAPABILITIES.OPERATIONS_MANAGE);
  // Decide on capability alone first, so people with no incident permissions never trigger an
  // incident lookup (and cannot probe which incidents exist).
  const preliminary = authorize({ actor, action });
  if (!preliminary.allowed) {
    void recordActionDenial(user.id, [preliminary.requiredCapability], preliminary.reason, {
      type: 'incident',
      id: incidentId,
    });
    throw new AuthorizationError(roleOnlyMessage, preliminary.requiredCapability);
  }
  const deniedMessage = `Unauthorized. You can ${operation} incidents assigned to you, that page you, or that belong to your teams. Responders and Admins can ${operation} any incident.`;
  const resource = await resolveIncidentResourceForActor(actor, incidentId);
  if (!resource) throw appError('INCIDENT_NOT_FOUND', 'Incident not found', { incidentId });
  const decision = authorize({ actor, action, resource });
  if (decision.allowed) return user;
  void recordActionDenial(user.id, [decision.requiredCapability], decision.reason, {
    type: 'incident',
    id: incidentId,
  });
  throw new AppError({
    code: 'INCIDENT_MODIFY_DENIED',
    userMessage: deniedMessage,
    details: {
      incidentId,
      action,
      reason: decision.reason,
      capability: decision.requiredCapability,
      requirement: describeRequirement(decision.requiredCapability).summary,
    },
  });
}

export const assertCanEscalateIncident = (incidentId: string) =>
  assertIncidentOperator(incidentId, 'escalate', AUTHORIZATION_ACTIONS.INCIDENT_ESCALATE);
export const assertCanResolveIncident = (incidentId: string) =>
  assertIncidentOperator(incidentId, 'resolve', AUTHORIZATION_ACTIONS.INCIDENT_RESOLVE);
export const assertCanManageIncidentMeeting = (incidentId: string) =>
  assertIncidentOperator(incidentId, 'manage meetings for');
export const assertCanManageWarRoom = (incidentId: string) =>
  assertIncidentOperator(incidentId, 'manage war rooms for');

/** Non-throwing variant for UI hints: which incident operations the current person may perform. */
export async function getIncidentOperatorPermissions(incidentId: string) {
  const user = await getCurrentUser();
  const actor = await resolveUserActor(user.id);
  const resource = actor ? await resolveIncidentResourceForActor(actor, incidentId) : null;
  const can = (action: AuthorizationAction) =>
    Boolean(actor && resource && authorize({ actor, action, resource }).allowed);
  return {
    canAcknowledge: can(AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE),
    canAddNote: can(AUTHORIZATION_ACTIONS.INCIDENT_NOTE),
    canEscalate: can(AUTHORIZATION_ACTIONS.INCIDENT_ESCALATE),
    canResolve: can(AUTHORIZATION_ACTIONS.INCIDENT_RESOLVE),
    canManage: can(AUTHORIZATION_ACTIONS.INCIDENT_MANAGE),
  };
}

export async function getUserPermissions() {
  try {
    const user = await getCurrentUser();
    const capabilities: readonly Capability[] = capabilitiesOf(user);
    const has = (capability: Capability) => capabilities.includes(capability);
    return {
      id: user.id,
      role: user.role as Role,
      capabilities,
      authenticated: true,
      isAdmin: has(CAPABILITIES.ADMIN_MANAGE),
      isAuditor: user.role === 'AUDITOR',
      isAdminOrResponder: has(CAPABILITIES.OPERATIONS_MANAGE),
      isResponderOrAbove: has(CAPABILITIES.OPERATIONS_MANAGE),
    };
  } catch {
    return {
      id: '',
      role: null as Role | null,
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
  return assertIncidentOperator(incidentId, 'modify');
}

export async function assertCanViewIncident(incidentId: string) {
  const user = await getCurrentUser();
  return assertIncidentPolicy(
    user,
    incidentId,
    AUTHORIZATION_ACTIONS.INCIDENT_READ,
    CAPABILITIES.INCIDENT_READ_SCOPED,
    'Unauthorized. You do not have permission to view this incident.'
  );
}

async function assertIncidentPolicy(
  user: Awaited<ReturnType<typeof getCurrentUser>>,
  incidentId: string,
  action:
    | typeof AUTHORIZATION_ACTIONS.INCIDENT_READ
    | typeof AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE
    | typeof AUTHORIZATION_ACTIONS.INCIDENT_NOTE,
  capability: Capability,
  deniedMessage: string
) {
  const actor = await resolveUserActor(user.id);
  if (!actor) {
    throw new AuthorizationError(deniedMessage, capability);
  }
  const preliminaryDecision = authorize({ actor, action });
  if (!preliminaryDecision.allowed) {
    throw new AuthorizationError(deniedMessage, capability);
  }
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    select: {
      assigneeId: true,
      teamId: true,
      visibility: true,
      watchers: { select: { userId: true } },
      service: { select: { teamId: true } },
    },
  });

  if (!incident) {
    throw appError('INCIDENT_NOT_FOUND', 'Incident not found', { incidentId });
  }
  const decision = authorize({
    actor,
    action,
    resource: {
      type: 'incident',
      assigneeId: incident.assigneeId,
      assignedTeamId: incident.teamId,
      visibility: incident.visibility,
      watcherIds: incident.watchers.map(watcher => watcher.userId),
      serviceTeamId: incident.service.teamId,
    },
  });
  if (decision.allowed) return user;

  throw appError('INCIDENT_ACCESS_DENIED', deniedMessage, { incidentId, userId: user.id, action });
}

export async function assertCanModifyService(serviceId: string) {
  const user = await getCurrentUser();
  if (user.role === 'ADMIN') return user;

  if (!capabilitiesOf(user).includes(CAPABILITIES.OPERATIONS_MANAGE)) {
    throw appError(
      'SERVICE_ACCESS_DENIED',
      'Unauthorized. You do not have permission to modify this service.',
      { serviceId, userId: user.id }
    );
  }

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

export async function assertCanViewService(serviceId: string) {
  const user = await getCurrentUser();
  const actor = await resolveUserActor(user.id);
  if (!actor) {
    throw new AuthorizationError(
      'Unauthorized. You do not have permission to view this service.',
      CAPABILITIES.SERVICE_READ_SCOPED
    );
  }

  const service = await prisma.service.findFirst({
    where: { id: serviceId, ...serviceReadWhere(actor) },
    select: { id: true },
  });
  if (service) return user;

  throw appError(
    'SERVICE_ACCESS_DENIED',
    'Unauthorized. You do not have permission to view this service.',
    {
      serviceId,
      userId: user.id,
    }
  );
}

export async function assertCanViewSchedule(scheduleId: string) {
  const user = await getCurrentUser();
  const capabilities = await resolveScheduleUICapabilities(scheduleId, user);
  if (capabilities.canViewSchedule) return { user, capabilities };

  throw appError(
    'SCHEDULE_ACCESS_DENIED',
    'Unauthorized. You do not have permission to view this schedule.',
    { scheduleId, userId: user.id }
  );
}

export async function getViewableScheduleWhere(): Promise<Prisma.OnCallScheduleWhereInput> {
  return scheduleReadWhere(await getCurrentAuthorizationActor());
}

async function resolveScheduleUICapabilities(
  scheduleId: string,
  user: Awaited<ReturnType<typeof getCurrentUser>>
): Promise<ScheduleUICapabilities> {
  const schedule = await prisma.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: {
      layers: {
        select: {
          users: { where: { userId: user.id }, select: { id: true } },
        },
      },
      overrides: {
        where: { OR: [{ userId: user.id }, { replacesUserId: user.id }] },
        select: { id: true },
        take: 1,
      },
      escalationRules: {
        where: {
          policy: {
            services: {
              some: {
                team: { members: { some: { userId: user.id, role: 'OWNER' } } },
              },
            },
          },
        },
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!schedule) {
    throw appError('SCHEDULE_NOT_FOUND', 'Schedule not found', { scheduleId });
  }

  const isAssignedMember = schedule.layers.some(layer => layer.users.length > 0);
  const isOwningTeamLead = schedule.escalationRules.length > 0;
  return deriveScheduleUICapabilities({
    capabilities: capabilitiesOf(user),
    isAdmin: user.role === 'ADMIN',
    isAssignedMember,
    isOwningTeamLead,
    hasScopedView: isAssignedMember || schedule.overrides.length > 0,
  });
}

export async function getScheduleUICapabilities(scheduleId: string) {
  const user = await getCurrentUser();
  return resolveScheduleUICapabilities(scheduleId, user);
}

export async function assertCanCreateScheduleOverride(scheduleId: string) {
  const user = await getCurrentUser();
  const capabilities = await resolveScheduleUICapabilities(scheduleId, user);
  if (capabilities.canCreateOverride) return user;

  throw new AppError({
    code: 'SCHEDULE_OVERRIDE_ACCESS_DENIED',
    userMessage:
      'Unauthorized. Only an administrator, owning team lead, or assigned schedule member can create overrides.',
    details: { scheduleId, userId: user.id },
  });
}
