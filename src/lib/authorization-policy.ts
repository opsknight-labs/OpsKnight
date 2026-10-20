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
  RESPONSE_POLICY_READ: 'response_policy.read',
  RESPONSE_POLICY_MANAGE: 'response_policy.manage',
  SCHEDULE_READ: 'schedule.read',
  SCHEDULE_MANAGE: 'schedule.manage',
  TEAM_READ: 'team.read',
  TEAM_MANAGE: 'team.manage',
  TEAM_MEMBERSHIP_READ: 'team.membership.read',
  TEAM_ACTIVITY_READ: 'team.activity.read',
  TEAM_MEMBERSHIP_MANAGE: 'team.membership.manage',
  USER_READ: 'user.read',
  USER_MANAGE: 'user.manage',
  USER_ADMINISTRATION_READ: 'user.administration.read',
  ESCALATION_POLICY_READ: 'escalation_policy.read',
  ESCALATION_POLICY_MANAGE: 'escalation_policy.manage',
  INTEGRATION_READ: 'integration.read',
  INTEGRATION_MANAGE: 'integration.manage',
  INTEGRATION_CREATE: 'integration.create',
  INTEGRATION_CREDENTIALS_MANAGE: 'integration.credentials.manage',
  INTEGRATION_TEST: 'integration.test',
  INTEGRATION_DELETE: 'integration.delete',
  NOTIFICATION_READ: 'notification.read',
  NOTIFICATION_MANAGE: 'notification.manage',
  NOTIFICATION_PREFERENCES_READ: 'notification.preferences.read',
  NOTIFICATION_PREFERENCES_MANAGE: 'notification.preferences.manage',
  NOTIFICATION_PROVIDER_READ: 'notification.provider.read',
  NOTIFICATION_PROVIDER_MANAGE: 'notification.provider.manage',
  NOTIFICATION_PROVIDER_TEST: 'notification.provider.test',
  STATUS_PAGE_SUBSCRIBER_READ: 'status_page.subscriber.read',
  STATUS_PAGE_SUBSCRIBER_MANAGE: 'status_page.subscriber.manage',
  STATUS_PAGE_READ: 'status_page.read',
  STATUS_PAGE_MANAGE: 'status_page.manage',
  AUTOMATION_READ: 'automation.read',
  AUTOMATION_WRITE: 'automation.write',
  AUTOMATION_PUBLISH: 'automation.publish',
  AUTOMATION_SETTINGS_READ: 'automation_settings.read',
  AUTOMATION_SETTINGS_WRITE: 'automation_settings.write',
  RUNBOOK_RULE_READ: 'runbook_rule.read',
  RUNBOOK_RULE_MANAGE: 'runbook_rule.manage',
  RUNBOOK_RULE_ACTIVATE: 'runbook_rule.activate',
  RUNBOOK_AGENT_MANAGE: 'runbook_agent.manage',
  RUNBOOK_POOL_MANAGE: 'runbook_pool.manage',
  RUNBOOK_SECRET_READ: 'runbook_secret.read',
  RUNBOOK_SECRET_MANAGE: 'runbook_secret.manage',
  RUNBOOK_SECRET_GRANT: 'runbook_secret.grant',
  RUNBOOK_SIGNING_READ: 'runbook_signing.read',
  RUNBOOK_SIGNING_MANAGE: 'runbook_signing.manage',
  RUNBOOK_SETTINGS_READ: 'runbook_settings.read',
  RUNBOOK_SETTINGS_MANAGE: 'runbook_settings.manage',
  RUNBOOK_AGENT_READ: 'runbook_agent.read',
  RUNBOOK_AGENT_ENROLL: 'runbook_agent.enroll',
  RUNBOOK_AGENT_REVOKE: 'runbook_agent.revoke',
  RUNBOOK_READ: 'runbook.read',
  RUNBOOK_EXECUTE: 'runbook.execute',
  RUNBOOK_APPROVE: 'runbook.approve',
  RUNBOOK_MANAGE: 'runbook.manage',
  RUNBOOK_PUBLISH: 'runbook.publish',
  AUDIT_READ: 'audit.read',
  REPORT_READ: 'report.read',
  SERVICE_OBJECTIVE_READ: 'service_objective.read',
  SERVICE_OBJECTIVE_MANAGE: 'service_objective.manage',
  SERVICE_OBJECTIVE_EVALUATE: 'service_objective.evaluate',
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
  | { type: 'team'; teamId?: string | null; ownerIds?: readonly string[] }
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
  [AUTHORIZATION_ACTIONS.RESPONSE_POLICY_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RESPONSE_POLICY_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.SCHEDULE_READ]: ScheduleResource;
  [AUTHORIZATION_ACTIONS.SCHEDULE_MANAGE]?: ScheduleResource;
  [AUTHORIZATION_ACTIONS.TEAM_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.TEAM_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.TEAM_ACTIVITY_READ]: Extract<AuthorizationResource, { type: 'team' }> & {
    ownerIds: readonly string[];
  };
  [AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_READ]: Extract<AuthorizationResource, { type: 'team' }>;
  [AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_MANAGE]: Extract<
    AuthorizationResource,
    { type: 'team' }
  > & { ownerIds: readonly string[] };
  [AUTHORIZATION_ACTIONS.USER_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.USER_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.USER_ADMINISTRATION_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.ESCALATION_POLICY_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.ESCALATION_POLICY_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.INTEGRATION_READ]?: ServiceResource;
  [AUTHORIZATION_ACTIONS.INTEGRATION_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.INTEGRATION_CREATE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.INTEGRATION_CREDENTIALS_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.INTEGRATION_TEST]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.INTEGRATION_DELETE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.NOTIFICATION_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.NOTIFICATION_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.NOTIFICATION_PREFERENCES_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.NOTIFICATION_PREFERENCES_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.NOTIFICATION_PROVIDER_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.NOTIFICATION_PROVIDER_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.NOTIFICATION_PROVIDER_TEST]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.STATUS_PAGE_SUBSCRIBER_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.STATUS_PAGE_SUBSCRIBER_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.STATUS_PAGE_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.STATUS_PAGE_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.AUTOMATION_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.AUTOMATION_WRITE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.AUTOMATION_PUBLISH]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.AUTOMATION_SETTINGS_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.AUTOMATION_SETTINGS_WRITE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_RULE_READ]?: ServiceResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_RULE_MANAGE]?: ServiceResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_RULE_ACTIVATE]?: ServiceResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_POOL_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_SECRET_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_SECRET_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_SECRET_GRANT]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_SIGNING_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_SIGNING_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_SETTINGS_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_SETTINGS_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_ENROLL]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_REVOKE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_EXECUTE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_APPROVE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.RUNBOOK_PUBLISH]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.AUDIT_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.REPORT_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_READ]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_MANAGE]?: AuthorizationResource;
  [AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_EVALUATE]?: AuthorizationResource;
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
    AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_MANAGE,
    { global: CAPABILITIES.RUNBOOK_AGENT_MANAGE, apiScope: API_SCOPES.RUNBOOK_AGENTS_WRITE },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_POOL_MANAGE,
    { global: CAPABILITIES.RUNBOOK_AGENT_MANAGE, apiScope: API_SCOPES.RUNBOOK_AGENT_POOLS_WRITE },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_SECRET_READ,
    { global: CAPABILITIES.RUNBOOK_SECRET_MANAGE, apiScope: API_SCOPES.RUNBOOK_SECRETS_READ },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_SECRET_MANAGE,
    { global: CAPABILITIES.RUNBOOK_SECRET_MANAGE, apiScope: API_SCOPES.RUNBOOK_SECRETS_WRITE },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_SECRET_GRANT,
    { global: CAPABILITIES.RUNBOOK_SECRET_MANAGE, apiScope: API_SCOPES.RUNBOOK_SECRETS_GRANT },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_SIGNING_READ,
    { global: CAPABILITIES.RUNBOOK_AGENT_MANAGE, apiScope: API_SCOPES.RUNBOOK_SIGNING_READ },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_SIGNING_MANAGE,
    { global: CAPABILITIES.RUNBOOK_AGENT_MANAGE, apiScope: API_SCOPES.RUNBOOK_SIGNING_WRITE },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_SETTINGS_READ,
    { global: CAPABILITIES.ADMIN_MANAGE, apiScope: API_SCOPES.RUNBOOK_SETTINGS_READ },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_SETTINGS_MANAGE,
    { global: CAPABILITIES.ADMIN_MANAGE, apiScope: API_SCOPES.RUNBOOK_SETTINGS_WRITE },
  ],

  [
    AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_READ,
    { global: CAPABILITIES.RUNBOOK_AGENT_MANAGE, apiScope: API_SCOPES.RUNBOOK_AGENTS_READ },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_ENROLL,
    { global: CAPABILITIES.RUNBOOK_AGENT_MANAGE, apiScope: API_SCOPES.RUNBOOK_AGENTS_ENROLL },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_AGENT_REVOKE,
    { global: CAPABILITIES.RUNBOOK_AGENT_MANAGE, apiScope: API_SCOPES.RUNBOOK_AGENTS_REVOKE },
  ],

  [
    AUTHORIZATION_ACTIONS.RUNBOOK_RULE_READ,
    { global: CAPABILITIES.RUNBOOK_MANAGE, apiScope: API_SCOPES.RUNBOOK_RULES_READ },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_RULE_MANAGE,
    { global: CAPABILITIES.RUNBOOK_MANAGE, apiScope: API_SCOPES.RUNBOOK_RULES_WRITE },
  ],
  [
    AUTHORIZATION_ACTIONS.RUNBOOK_RULE_ACTIVATE,
    { global: CAPABILITIES.RUNBOOK_MANAGE, apiScope: API_SCOPES.RUNBOOK_RULES_ACTIVATE },
  ],
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
    AUTHORIZATION_ACTIONS.RESPONSE_POLICY_READ,
    { global: CAPABILITIES.ADMIN_MANAGE, apiScope: API_SCOPES.RESPONSE_POLICY_READ },
  ],
  [
    AUTHORIZATION_ACTIONS.RESPONSE_POLICY_MANAGE,
    { global: CAPABILITIES.ADMIN_MANAGE, apiScope: API_SCOPES.RESPONSE_POLICY_WRITE },
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
    AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_READ,
    {
      global: CAPABILITIES.USER_READ_ALL,
      scoped: CAPABILITIES.SERVICE_READ_SCOPED,
      apiScope: API_SCOPES.TEAMS_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.TEAM_ACTIVITY_READ,
    {
      global: CAPABILITIES.ADMIN_MANAGE,
      scoped: CAPABILITIES.TEAM_ADMINISTER_SCOPED,
      apiScope: API_SCOPES.TEAMS_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_MANAGE,
    {
      global: CAPABILITIES.ADMIN_MANAGE,
      scoped: CAPABILITIES.TEAM_ADMINISTER_SCOPED,
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
    AUTHORIZATION_ACTIONS.USER_ADMINISTRATION_READ,
    { global: CAPABILITIES.ADMIN_MANAGE, apiScope: API_SCOPES.USERS_READ },
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
    AUTHORIZATION_ACTIONS.INTEGRATION_CREATE,
    { global: CAPABILITIES.ADMIN_MANAGE, apiScope: API_SCOPES.INTEGRATIONS_CREATE },
  ],
  [
    AUTHORIZATION_ACTIONS.INTEGRATION_CREDENTIALS_MANAGE,
    { global: CAPABILITIES.ADMIN_MANAGE, apiScope: API_SCOPES.INTEGRATIONS_CREDENTIALS_WRITE },
  ],
  [
    AUTHORIZATION_ACTIONS.INTEGRATION_TEST,
    { global: CAPABILITIES.ADMIN_MANAGE, apiScope: API_SCOPES.INTEGRATIONS_TEST },
  ],
  [
    AUTHORIZATION_ACTIONS.INTEGRATION_DELETE,
    { global: CAPABILITIES.ADMIN_MANAGE, apiScope: API_SCOPES.INTEGRATIONS_DELETE },
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
    AUTHORIZATION_ACTIONS.NOTIFICATION_PREFERENCES_READ,
    {
      global: CAPABILITIES.USER_NOTIFICATION_PREFERENCES,
      apiScope: API_SCOPES.NOTIFICATION_PREFERENCES_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.NOTIFICATION_PREFERENCES_MANAGE,
    {
      global: CAPABILITIES.USER_NOTIFICATION_PREFERENCES,
      apiScope: API_SCOPES.NOTIFICATION_PREFERENCES_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.NOTIFICATION_PROVIDER_READ,
    {
      global: CAPABILITIES.ADMIN_MANAGE,
      apiScope: API_SCOPES.NOTIFICATION_PROVIDERS_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.NOTIFICATION_PROVIDER_MANAGE,
    {
      global: CAPABILITIES.ADMIN_MANAGE,
      apiScope: API_SCOPES.NOTIFICATION_PROVIDERS_WRITE,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.NOTIFICATION_PROVIDER_TEST,
    {
      global: CAPABILITIES.ADMIN_MANAGE,
      apiScope: API_SCOPES.NOTIFICATION_PROVIDERS_TEST,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.STATUS_PAGE_SUBSCRIBER_READ,
    { global: CAPABILITIES.ADMIN_MANAGE, apiScope: API_SCOPES.STATUS_PAGE_SUBSCRIBERS_READ },
  ],
  [
    AUTHORIZATION_ACTIONS.STATUS_PAGE_SUBSCRIBER_MANAGE,
    { global: CAPABILITIES.ADMIN_MANAGE, apiScope: API_SCOPES.STATUS_PAGE_SUBSCRIBERS_WRITE },
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
    AUTHORIZATION_ACTIONS.RUNBOOK_APPROVE,
    { global: CAPABILITIES.RUNBOOK_APPROVE, apiScope: API_SCOPES.RUNBOOKS_APPROVE },
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
    AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_READ,
    {
      global: CAPABILITIES.METRICS_READ_ALL,
      scoped: CAPABILITIES.METRICS_READ_SCOPED,
      apiScope: API_SCOPES.SERVICE_OBJECTIVES_READ,
    },
  ],
  [
    AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_MANAGE,
    { global: CAPABILITIES.ADMIN_MANAGE, apiScope: API_SCOPES.SERVICE_OBJECTIVES_WRITE },
  ],
  [
    AUTHORIZATION_ACTIONS.SERVICE_OBJECTIVE_EVALUATE,
    {
      global: CAPABILITIES.METRICS_READ_ALL,
      scoped: CAPABILITIES.METRICS_READ_SCOPED,
      apiScope: API_SCOPES.SERVICE_OBJECTIVES_EVALUATE,
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
  if (resource.type === 'team')
    return resource.ownerIds !== undefined
      ? resource.ownerIds.includes(actor.id)
      : Boolean(resource.teamId && teams.has(resource.teamId));
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
  if (
    (action === AUTHORIZATION_ACTIONS.TEAM_MEMBERSHIP_MANAGE ||
      action === AUTHORIZATION_ACTIONS.TEAM_ACTIVITY_READ) &&
    (resource.type !== 'team' || !resource.ownerIds?.includes(actor.id))
  )
    return { allowed: false, reason: 'RESOURCE_OUT_OF_SCOPE', requiredCapability: policy.scoped };
  if (isResourceInScope(actor, resource)) return { allowed: true, scope: 'resource' };
  return { allowed: false, reason: 'RESOURCE_OUT_OF_SCOPE', requiredCapability: policy.scoped };
}
