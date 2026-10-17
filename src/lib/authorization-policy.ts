import {
  API_SCOPES,
  EXPLICIT_API_SCOPES,
  CAPABILITIES,
  hasCapability,
  type ApiScope,
  type AppRole,
  type Capability,
} from '@/lib/authorization';

export const AUTHORIZATION_ACTIONS = {
  INCIDENT_READ: 'incident.read',
  INCIDENT_CREATE: 'incident.create',
  INCIDENT_ACKNOWLEDGE: 'incident.acknowledge',
  INCIDENT_ESCALATE: 'incident.escalate',
  INCIDENT_NOTE: 'incident.note',
  INCIDENT_MANAGE: 'incident.manage',
  EVENT_CREATE: 'event.create',
  SERVICE_READ: 'service.read',
  SERVICE_CREATE: 'service.create',
  SERVICE_UPDATE: 'service.update',
  SERVICE_DELETE: 'service.delete',
  SCHEDULE_READ: 'schedule.read',
  SCHEDULE_MANAGE: 'schedule.manage',
  TEAM_READ: 'team.read',
  TEAM_MANAGE: 'team.manage',
  USER_READ: 'user.read',
  USER_MANAGE: 'user.manage',
  ESCALATION_POLICY_READ: 'escalation_policy.read',
  ESCALATION_POLICY_MANAGE: 'escalation_policy.manage',
  INTEGRATION_READ: 'integration.read',
  INTEGRATION_MANAGE: 'integration.manage',
  NOTIFICATION_READ: 'notification.read',
  NOTIFICATION_MANAGE: 'notification.manage',
  STATUS_PAGE_READ: 'status_page.read',
  STATUS_PAGE_MANAGE: 'status_page.manage',
  AUTOMATION_READ: 'automation.read',
  AUTOMATION_WRITE: 'automation.write',
  AUTOMATION_PUBLISH: 'automation.publish',
  AUTOMATION_SETTINGS_READ: 'automation_settings.read',
  AUTOMATION_SETTINGS_WRITE: 'automation_settings.write',
  RUNBOOK_READ: 'runbook.read',
  RUNBOOK_EXECUTE: 'runbook.execute',
  RUNBOOK_MANAGE: 'runbook.manage',
  RUNBOOK_PUBLISH: 'runbook.publish',
  AUDIT_READ: 'audit.read',
  REPORT_READ: 'report.read',
  POSTMORTEM_READ: 'postmortem.read',
  POSTMORTEM_MANAGE: 'postmortem.manage',
  SERVICE_ACCOUNT_READ: 'service_account.read',
  SERVICE_ACCOUNT_MANAGE: 'service_account.manage',
} as const;

export type AuthorizationAction =
  (typeof AUTHORIZATION_ACTIONS)[keyof typeof AUTHORIZATION_ACTIONS];

export type AuthorizationActor = {
  id: string;
  role: AppRole;
  status: 'ACTIVE' | 'INVITED' | 'DISABLED';
  teamIds: readonly string[];
  apiKey?: { id: string; scopes: readonly string[] };
};

export type AuthorizationResource =
  | {
      type: 'incident';
      assigneeId?: string | null;
      watcherIds?: readonly string[];
      visibility?: 'PUBLIC' | 'PRIVATE';
      serviceTeamId?: string | null;
      assignedTeamId?: string | null;
    }
  | { type: 'service'; teamId?: string | null }
  | { type: 'schedule'; participantIds?: readonly string[]; relatedTeamIds?: readonly string[] }
  | { type: 'team'; teamId?: string | null }
  | { type: 'status_page'; teamId?: string | null };

type IncidentResource = Extract<AuthorizationResource, { type: 'incident' }>;
type ServiceResource = Extract<AuthorizationResource, { type: 'service' }>;
type ScheduleResource = Extract<AuthorizationResource, { type: 'schedule' }>;

type AuthorizationResourceByAction = {
  [AUTHORIZATION_ACTIONS.INCIDENT_READ]: IncidentResource;
  [AUTHORIZATION_ACTIONS.INCIDENT_CREATE]: ServiceResource;
  [AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE]: IncidentResource;
  [AUTHORIZATION_ACTIONS.INCIDENT_ESCALATE]: IncidentResource;
  [AUTHORIZATION_ACTIONS.INCIDENT_NOTE]: IncidentResource;
  [AUTHORIZATION_ACTIONS.INCIDENT_MANAGE]: IncidentResource;
  [AUTHORIZATION_ACTIONS.EVENT_CREATE]: ServiceResource;
  [AUTHORIZATION_ACTIONS.SERVICE_READ]: ServiceResource;
  [AUTHORIZATION_ACTIONS.SERVICE_CREATE]?: ServiceResource;
  [AUTHORIZATION_ACTIONS.SERVICE_UPDATE]?: ServiceResource;
  [AUTHORIZATION_ACTIONS.SERVICE_DELETE]?: ServiceResource;
  [AUTHORIZATION_ACTIONS.SCHEDULE_READ]: ScheduleResource;
  [AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE]?: ScheduleResource;
  [AUTHORIZATION_ACTIONS.TEAM_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.TEAM_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.USER_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.USER_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.ESCALATION_POLICY_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.ESCALATION_POLICY_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.INTEGRATION_READ]?: ServiceResource;
  [AUTHORIZATION_ACTIONS.INTEGRATION_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.NOTIFICATION_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.NOTIFICATION_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.STATUS_PAGE_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.AUTOMATION_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.AUTOMATION_WRITE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.AUTOMATION_PUBLISH]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.AUTOMATION_SETTINGS_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.AUTOMATION_SETTINGS_WRITE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_PUBLISH]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.AUDIT_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.REPORT_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.POSTMORTEM_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.SERVICE_ACCOUNT_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.SERVICE_ACCOUNT_MANAGE]?: AuthorizationResource;
};

export type AuthorizationRequest<A extends AuthorizationAction = AuthorizationAction> = {
  actor: AuthorizationActor;
  action: A;
  resource?: AuthorizationResourceByAction[A];
};

export type AuthorizationDecision =
  | { allowed: true; scope: 'global' | 'resource' }
  | {
      allowed: false;
      reason: 'ACTOR_INACTIVE' | 'MISSING_SCOPE' | 'MISSING_CAPABILITY' | 'RESOURCE_OUT_OF_SCOPE';
      requiredCapability: Capability;
      requiredScope?: ApiScope;
    };

type ActionPolicy = {
  global: Capability;
  scoped?: Capability;
  apiScope?: ApiScope;
};

const ACTION_POLICIES = new Map<AuthorizationAction, ActionPolicy>([
  [
    AUTHORIZATION_ACTIONS.AUTOMATION_PUBLISH,
    { global: CAPABILITIES.AUTOMATION_PUBLISH, apiScope: API_SCOPES.AUTOMATION_PUBLISH },
  ],
  [
    AUTHORIZATION_ACTIONS.AUTOMATION_READ,
    { global: CAPABILITIES.AUTOMATION_READ, apiScope: API_SCOPES.AUTOMATION_READ },
  ],
  [
    AUTHORIZATION_ACTIONS.AUTOMATION_WRITE,
    { global: CAPABILITIES.AUTOMATION_EDIT, apiScope: API_SCOPES.AUTOMATION_WRITE },
  ],
  [
    AUTHORIZATION_ACTIONS.INCIDENT_READ,
    {
      global: CAPABILITIES.INCIDENT_READ_ALL,
      scoped: CAPABILITIES.INCIDENT_READ_SCOPED,
      apiScope: API_SCOPES.INCIDENTS_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.INCIDENT_CREATE,
    {
      global: CAPABILITIES.INCIDENT_CREATE_ALL,
      apiScope: API_SCOPES.INCIDENTS_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
    {
      global: CAPABILITIES.OPERATIONS_MANAGE,
      apiScope: API_SCOPES.INCIDENTS_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE,
    {
      global: CAPABILITIES.OPERATIONS_MANAGE,
      apiScope: API_SCOPES.INCIDENTS_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.INCIDENT_ESCALATE,
    {
      global: CAPABILITIES.OPERATIONS_MANAGE,
      apiScope: API_SCOPES.INCIDENTS_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.INCIDENT_NOTE,
    {
      global: CAPABILITIES.OPERATIONS_MANAGE,
      apiScope: API_SCOPES.INCIDENTS_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.EVENT_CREATE,
    {
      global: CAPABILITIES.OPERATIONS_MANAGE,
      apiScope: API_SCOPES.EVENTS_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.SERVICE_READ,
    {
      global: CAPABILITIES.SERVICE_READ_ALL,
      scoped: CAPABILITIES.SERVICE_READ_SCOPED,
      apiScope: API_SCOPES.SERVICES_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.SERVICE_CREATE,
    {
      global: CAPABILITIES.OPERATIONS_MANAGE,
      apiScope: API_SCOPES.SERVICES_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.SERVICE_UPDATE,
    {
      global: CAPABILITIES.OPERATIONS_MANAGE,
      apiScope: API_SCOPES.SERVICES_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.SERVICE_DELETE,
    {
      global: CAPABILITIES.ADMIN_MANAGE,
      apiScope: API_SCOPES.SERVICES_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.SCHEDULE_READ,
    {
      global: CAPABILITIES.SCHEDULE_READ_ALL,
      scoped: CAPABILITIES.SCHEDULE_READ_SCOPED,
      apiScope: API_SCOPES.SCHEDULES_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE,
    {
      global: CAPABILITIES.OPERATIONS_MANAGE,
      apiScope: API_SCOPES.SCHEDULES_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.TEAM_READ,
    {
      global: CAPABILITIES.USER_READ_ALL,
      scoped: CAPABILITIES.USER_READ_ALL,
      apiScope: API_SCOPES.TEAMS_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.TEAM_MANAGE,
    {
      global: CAPABILITIES.ADMIN_MANAGE,
      apiScope: API_SCOPES.TEAMS_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.USER_READ,
    {
      global: CAPABILITIES.USER_READ_ALL,
      apiScope: API_SCOPES.USERS_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.USER_MANAGE,
    {
      global: CAPABILITIES.ADMIN_MANAGE,
      apiScope: API_SCOPES.USERS_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.ESCALATION_POLICY_READ,
    {
      global: CAPABILITIES.POLICY_READ_ALL,
      apiScope: API_SCOPES.ESCALATION_POLICIES_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.ESCALATION_POLICY_MANAGE,
    {
      global: CAPABILITIES.ADMIN_MANAGE,
      apiScope: API_SCOPES.ESCALATION_POLICIES_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.INTEGRATION_READ,
    {
      global: CAPABILITIES.SERVICE_READ_ALL,
      scoped: CAPABILITIES.SERVICE_READ_SCOPED,
      apiScope: API_SCOPES.INTEGRATIONS_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.INTEGRATION_MANAGE,
    {
      global: CAPABILITIES.ADMIN_MANAGE,
      apiScope: API_SCOPES.INTEGRATIONS_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.NOTIFICATION_READ,
    {
      global: CAPABILITIES.OPERATIONS_MANAGE,
      scoped: CAPABILITIES.USER_READ_ALL,
      apiScope: API_SCOPES.NOTIFICATIONS_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.NOTIFICATION_MANAGE,
    {
      global: CAPABILITIES.OPERATIONS_MANAGE,
      apiScope: API_SCOPES.NOTIFICATIONS_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.STATUS_PAGE_READ,
    {
      global: CAPABILITIES.SERVICE_READ_ALL,
      apiScope: API_SCOPES.STATUS_PAGES_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE,
    {
      global: CAPABILITIES.ADMIN_MANAGE,
      apiScope: API_SCOPES.STATUS_PAGES_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.AUTOMATION_SETTINGS_READ,
    { global: CAPABILITIES.AUTOMATION_PUBLISH, apiScope: API_SCOPES.AUTOMATION_SETTINGS_READ },
  ],
  [
    AUTHORIZATION_ACTIONS.AUTOMATION_SETTINGS_WRITE,
    { global: CAPABILITIES.AUTOMATION_PUBLISH, apiScope: API_SCOPES.AUTOMATION_SETTINGS_WRITE },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_READ,
    {
      global: CAPABILITIES.RUNBOOK_READ_ALL,
      scoped: CAPABILITIES.RUNBOOK_READ_SCOPED,
      apiScope: API_SCOPES.RUNBOOKS_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE,
    {
      global: CAPABILITIES.RUNBOOK_EXECUTE,
      apiScope: API_SCOPES.RUNBOOKS_EXECUTE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_MANAGE,
    {
      global: CAPABILITIES.RUNBOOK_MANAGE,
      apiScope: API_SCOPES.RUNBOOKS_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_PUBLISH,
    { global: CAPABILITIES.RUNBOOK_PUBLISH, apiScope: API_SCOPES.RUNBOOKS_PUBLISH },
  ],
  [
    AUTHORIZATION_ACTIONS.AUDIT_READ,
    {
      global: CAPABILITIES.AUDIT_READ,
      apiScope: API_SCOPES.AUDIT_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.REPORT_READ,
    {
      global: CAPABILITIES.REPORT_READ,
      scoped: CAPABILITIES.REPORT_READ,
      apiScope: API_SCOPES.REPORTS_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.POSTMORTEM_READ,
    {
      global: CAPABILITIES.INCIDENT_READ_ALL,
      scoped: CAPABILITIES.INCIDENT_READ_SCOPED,
      apiScope: API_SCOPES.POSTMORTEMS_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.POSTMORTEM_MANAGE,
    {
      global: CAPABILITIES.OPERATIONS_MANAGE,
      apiScope: API_SCOPES.POSTMORTEMS_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.SERVICE_ACCOUNT_READ,
    {
      global: CAPABILITIES.ADMIN_MANAGE,
      apiScope: API_SCOPES.SERVICE_ACCOUNTS_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.SERVICE_ACCOUNT_MANAGE,
    {
      global: CAPABILITIES.ADMIN_MANAGE,
      apiScope: API_SCOPES.SERVICE_ACCOUNTS_WRITE,
    },
  ],
]);

function isResourceInScope(actor: AuthorizationActor, resource: AuthorizationResource): boolean {
  const teams = new Set(actor.teamIds);
  if (resource.type === 'service') return Boolean(resource.teamId && teams.has(resource.teamId));
  if (resource.type === 'schedule') {
    return (
      resource.participantIds?.includes(actor.id) === true ||
      resource.relatedTeamIds?.some(teamId => teams.has(teamId)) === true
    );
  }
  if (resource.type === 'team') return Boolean(resource.teamId && teams.has(resource.teamId));
  if (resource.type === 'status_page') return true;
  if (resource.type === 'incident') {
    if (resource.assigneeId === actor.id || resource.watcherIds?.includes(actor.id)) return true;
    if (resource.visibility !== 'PUBLIC') return false;
    return Boolean(
      (resource.serviceTeamId && teams.has(resource.serviceTeamId)) ||
      (resource.assignedTeamId && teams.has(resource.assignedTeamId))
    );
  }
  return false;
}

/** The API scope that authorises an action, if the action is reachable with an API credential. */
export function apiScopeForAction(action: AuthorizationAction): ApiScope | undefined {
  return ACTION_POLICIES.get(action)?.apiScope;
}

export function authorize<A extends AuthorizationAction>(
  input: AuthorizationRequest<A>
): AuthorizationDecision {
  const { actor, action, resource } = input;
  const policy = ACTION_POLICIES.get(action);
  if (!policy) throw new Error(`Unknown authorization action: ${action}`);
  if (actor.status !== 'ACTIVE') {
    return { allowed: false, reason: 'ACTOR_INACTIVE', requiredCapability: policy.global };
  }
  if (
    actor.apiKey &&
    policy.apiScope &&
    !actor.apiKey.scopes.includes(policy.apiScope) &&
    !(
      actor.apiKey.scopes.includes(API_SCOPES.ADMIN_MANAGE) &&
      !EXPLICIT_API_SCOPES.has(policy.apiScope)
    )
  ) {
    return {
      allowed: false,
      reason: 'MISSING_SCOPE',
      requiredCapability: policy.global,
      requiredScope: policy.apiScope,
    };
  }
  if (hasCapability(actor.role, policy.global)) return { allowed: true, scope: 'global' };
  if (!policy.scoped || !hasCapability(actor.role, policy.scoped)) {
    return { allowed: false, reason: 'MISSING_CAPABILITY', requiredCapability: policy.global };
  }
  if (!resource) return { allowed: true, scope: 'resource' };
  if (isResourceInScope(actor, resource)) return { allowed: true, scope: 'resource' };
  return { allowed: false, reason: 'RESOURCE_OUT_OF_SCOPE', requiredCapability: policy.scoped };
}
