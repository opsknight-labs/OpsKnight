import {
  API_SCOPES,
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
  INCIDENT_NOTE: 'incident.note',
  INCIDENT_MANAGE: 'incident.manage',
  EVENT_CREATE: 'event.create',
  SERVICE_READ: 'service.read',
  SCHEDULE_READ: 'schedule.read',
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
  | { type: 'schedule'; participantIds?: readonly string[]; relatedTeamIds?: readonly string[] };

type IncidentResource = Extract<AuthorizationResource, { type: 'incident' }>;
type ServiceResource = Extract<AuthorizationResource, { type: 'service' }>;
type ScheduleResource = Extract<AuthorizationResource, { type: 'schedule' }>;

type AuthorizationResourceByAction = {
  [AUTHORIZATION_ACTIONS.INCIDENT_READ]: IncidentResource;
  [AUTHORIZATION_ACTIONS.INCIDENT_CREATE]: ServiceResource;
  [AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE]: IncidentResource;
  [AUTHORIZATION_ACTIONS.INCIDENT_NOTE]: IncidentResource;
  [AUTHORIZATION_ACTIONS.INCIDENT_MANAGE]: IncidentResource;
  [AUTHORIZATION_ACTIONS.EVENT_CREATE]: ServiceResource;
  [AUTHORIZATION_ACTIONS.SERVICE_READ]: ServiceResource;
  [AUTHORIZATION_ACTIONS.SCHEDULE_READ]: ScheduleResource;
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
      scoped: CAPABILITIES.INCIDENT_CREATE_SCOPED,
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
      scoped: CAPABILITIES.INCIDENT_ACKNOWLEDGE_SCOPED,
      apiScope: API_SCOPES.INCIDENTS_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.INCIDENT_NOTE,
    {
      global: CAPABILITIES.OPERATIONS_MANAGE,
      scoped: CAPABILITIES.INCIDENT_NOTE_SCOPED,
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
    AUTHORIZATION_ACTIONS.SCHEDULE_READ,
    {
      global: CAPABILITIES.SCHEDULE_READ_ALL,
      scoped: CAPABILITIES.SCHEDULE_READ_SCOPED,
      apiScope: API_SCOPES.SCHEDULES_READ,
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
  if (resource.assigneeId === actor.id || resource.watcherIds?.includes(actor.id)) return true;
  if (resource.visibility !== 'PUBLIC') return false;
  return Boolean(
    (resource.serviceTeamId && teams.has(resource.serviceTeamId)) ||
    (resource.assignedTeamId && teams.has(resource.assignedTeamId))
  );
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
  if (actor.apiKey && policy.apiScope && !actor.apiKey.scopes.includes(policy.apiScope)) {
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
