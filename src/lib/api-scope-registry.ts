import { API_SCOPES, type ApiScope } from '@/lib/authorization';

/**
 * Single source of truth for API scope metadata. Every consumer that lists,
 * labels, validates or restricts scopes (API key and service-account issuance,
 * the settings UI, documentation) derives from this registry, so a scope cannot
 * be shown, issued or described differently in different places.
 *
 * Typed as Record<ApiScope, ...>: adding a scope to API_SCOPES without describing
 * it here is a compile error.
 */
type IssuerRole = 'ADMIN' | 'RESPONDER' | 'AUDITOR' | 'USER';

const ALL_ROLES: readonly IssuerRole[] = ['ADMIN', 'RESPONDER', 'AUDITOR', 'USER'];
const OPERATORS: readonly IssuerRole[] = ['ADMIN', 'RESPONDER'];
const ADMINS: readonly IssuerRole[] = ['ADMIN'];
// Directory-wide reads need a capability the USER role does not have.
const NON_USER: readonly IssuerRole[] = ['ADMIN', 'RESPONDER', 'AUDITOR'];

export interface ApiScopeDefinition {
  scope: ApiScope;
  title: string;
  description: string;
  category: string;
  /** Mutating or executing scopes. */
  write: boolean;
  /** Roles allowed to mint a credential carrying this scope. */
  issuableBy: readonly IssuerRole[];
  /**
   * `active`: enforced by at least one shipped endpoint.
   * `reserved`: defined and recognised, but currently grants nothing on the REST v2
   * surface, so it is not offered for new credentials.
   */
  status: 'active' | 'reserved';
}

function def(
  scope: ApiScope,
  title: string,
  category: string,
  description: string,
  options: {
    write?: boolean;
    issuableBy?: readonly IssuerRole[];
    status?: 'active' | 'reserved';
  } = {}
): ApiScopeDefinition {
  return {
    scope,
    title,
    category,
    description,
    write: options.write ?? false,
    issuableBy: options.issuableBy ?? (options.write ? OPERATORS : ALL_ROLES),
    status: options.status ?? 'active',
  };
}

const S = API_SCOPES;

export const API_SCOPE_REGISTRY: Record<ApiScope, ApiScopeDefinition> = {
  [S.RUNBOOK_AGENTS_READ]: def(
    S.RUNBOOK_AGENTS_READ,
    'Agent fleet read',
    'Runbooks',
    'Read safe Agent fleet health and enrollment status without credentials.',
    { issuableBy: ADMINS }
  ),
  [S.RUNBOOK_AGENTS_ENROLL]: def(
    S.RUNBOOK_AGENTS_ENROLL,
    'Agent enrollment',
    'Runbooks',
    'Issue one-time Agent enrollment material. Replays return metadata only.',
    { write: true, issuableBy: ADMINS }
  ),
  [S.RUNBOOK_AGENTS_REVOKE]: def(
    S.RUNBOOK_AGENTS_REVOKE,
    'Agent revocation',
    'Runbooks',
    'Revoke Agent identity and future assignments.',
    { write: true, issuableBy: ADMINS }
  ),

  [S.STATUS_PAGE_SUBSCRIBERS_READ]: def(
    S.STATUS_PAGE_SUBSCRIBERS_READ,
    'Status page subscribers read',
    'Status pages',
    'Read subscriber contact addresses and delivery eligibility. Administrator-only explicit privacy scope.',
    { issuableBy: ADMINS }
  ),
  [S.STATUS_PAGE_SUBSCRIBERS_WRITE]: def(
    S.STATUS_PAGE_SUBSCRIBERS_WRITE,
    'Status page subscribers remove',
    'Status pages',
    'Revoke status page subscriptions and pending notifications. Does not enroll, verify or reactivate recipients.',
    { write: true, issuableBy: ADMINS }
  ),
  [S.AUTOMATION_PUBLISH]: def(
    S.AUTOMATION_PUBLISH,
    'Automation publish',
    'Automation',
    'Publish validated immutable service automation versions with explicit administrator privilege.',
    { write: true, issuableBy: ADMINS }
  ),
  [S.AUTOMATION_READ]: def(
    S.AUTOMATION_READ,
    'Automation read',
    'Automation',
    'Read permitted service automation drafts.',
    { issuableBy: NON_USER }
  ),
  [S.AUTOMATION_WRITE]: def(
    S.AUTOMATION_WRITE,
    'Automation drafts',
    'Automation',
    'Edit service automation drafts. Responders must belong to the service team.',
    { write: true, issuableBy: OPERATORS }
  ),
  [S.AUTOMATION_SETTINGS_READ]: def(
    S.AUTOMATION_SETTINGS_READ,
    'Automation settings read',
    'Automation',
    'Read administrative automation settings with explicit administrator privilege.',
    { issuableBy: ADMINS }
  ),
  [S.AUTOMATION_SETTINGS_WRITE]: def(
    S.AUTOMATION_SETTINGS_WRITE,
    'Automation settings manage',
    'Automation',
    'Change the global kill switch and trace retention with revision protection.',
    { write: true, issuableBy: ADMINS }
  ),
  [S.EVENTS_WRITE]: def(
    S.EVENTS_WRITE,
    'Events ingestion',
    'Events',
    'Send monitoring events to the Events API.',
    { write: true }
  ),
  [S.INCIDENTS_READ]: def(
    S.INCIDENTS_READ,
    'Incidents read',
    'Incidents',
    'List and read incidents, notes and timelines.'
  ),
  [S.INCIDENTS_WRITE]: def(
    S.INCIDENTS_WRITE,
    'Incidents manage',
    'Incidents',
    'Create, update, acknowledge, resolve, assign and annotate incidents.',
    { write: true }
  ),
  [S.SERVICES_READ]: def(S.SERVICES_READ, 'Services read', 'Services', 'List and read services.'),
  [S.SERVICES_WRITE]: def(
    S.SERVICES_WRITE,
    'Services manage',
    'Services',
    'Create, update and delete services.',
    { write: true }
  ),
  [S.SCHEDULES_READ]: def(
    S.SCHEDULES_READ,
    'Schedules read',
    'Schedules',
    'Read on-call schedules and who is on call.'
  ),
  [S.SCHEDULES_WRITE]: def(
    S.SCHEDULES_WRITE,
    'Schedules manage',
    'Schedules',
    'Create and update schedules, manage rotation participants, and create overrides. Layer configuration editing is not available over REST.',
    { write: true }
  ),
  [S.TEAMS_READ]: def(S.TEAMS_READ, 'Teams read', 'Teams', 'List and read teams.', {
    issuableBy: NON_USER,
  }),
  [S.TEAMS_WRITE]: def(S.TEAMS_WRITE, 'Teams manage', 'Teams', 'Create, update and delete teams.', {
    write: true,
    issuableBy: ADMINS,
  }),
  [S.USERS_READ]: def(S.USERS_READ, 'Users read', 'Users', 'List and read users.', {
    issuableBy: NON_USER,
  }),
  [S.USERS_WRITE]: def(
    S.USERS_WRITE,
    'Users manage',
    'Users',
    'Reserved: no REST v2 endpoint modifies users yet.',
    { write: true, issuableBy: ADMINS, status: 'reserved' }
  ),
  [S.ESCALATION_POLICIES_READ]: def(
    S.ESCALATION_POLICIES_READ,
    'Escalation policies read',
    'Escalations',
    'List and read escalation policies.',
    { issuableBy: NON_USER }
  ),
  [S.ESCALATION_POLICIES_WRITE]: def(
    S.ESCALATION_POLICIES_WRITE,
    'Escalation policies manage',
    'Escalations',
    'Create, update and delete escalation policies.',
    { write: true, issuableBy: ADMINS }
  ),
  [S.INTEGRATIONS_READ]: def(
    S.INTEGRATIONS_READ,
    'Integrations read',
    'Integrations',
    'List and read integrations.'
  ),
  [S.INTEGRATIONS_WRITE]: def(
    S.INTEGRATIONS_WRITE,
    'Integrations update',
    'Integrations',
    'Rename and enable or disable existing integrations. Creating integrations and editing connector configuration is not available over REST.',
    { write: true, issuableBy: ADMINS }
  ),
  [S.NOTIFICATIONS_READ]: def(
    S.NOTIFICATIONS_READ,
    'Notifications read',
    'Notifications',
    'Read notification delivery history.',
    { issuableBy: NON_USER }
  ),
  [S.NOTIFICATIONS_WRITE]: def(
    S.NOTIFICATIONS_WRITE,
    'Notifications retry',
    'Notifications',
    'Retry failed notification deliveries.',
    { write: true }
  ),
  [S.STATUS_PAGES_READ]: def(
    S.STATUS_PAGES_READ,
    'Status pages read',
    'Status pages',
    'List and read status pages.',
    { issuableBy: NON_USER }
  ),
  [S.STATUS_PAGES_WRITE]: def(
    S.STATUS_PAGES_WRITE,
    'Status pages manage',
    'Status pages',
    'Create status pages, configure supported sections and service components, post announcements and request durable publication retry. Subscriber contacts and revocation require separate explicit subscriber scopes; domain proof and asset upload remain unfinished.',
    { write: true, issuableBy: ADMINS }
  ),
  [S.SERVICE_OBJECTIVES_READ]: def(
    S.SERVICE_OBJECTIVES_READ,
    'Service objectives read',
    'Reports',
    'Read authorized objective definitions, immutable versions and evaluation jobs. Shared snapshot/history reads require global metrics visibility; scoped readers can request actor-filtered evaluations.',
    { issuableBy: ALL_ROLES }
  ),
  [S.SERVICE_OBJECTIVES_WRITE]: def(
    S.SERVICE_OBJECTIVES_WRITE,
    'Service objectives configure',
    'Reports',
    'Create, version or archive service objectives. Explicit administrator scope; changes retain immutable historical definitions.',
    { write: true, issuableBy: ADMINS }
  ),
  [S.SERVICE_OBJECTIVES_EVALUATE]: def(
    S.SERVICE_OBJECTIVES_EVALUATE,
    'Service objectives evaluate',
    'Reports',
    'Request quota-bound asynchronous evaluation of an authorized immutable definition. Does not modify scheduled shared history.',
    { write: true, issuableBy: ALL_ROLES }
  ),
  [S.RUNBOOKS_READ]: def(
    S.RUNBOOKS_READ,
    'Runbooks read',
    'Runbooks',
    'List runbooks, read step summaries (never step configuration) and read execution state.',
    { issuableBy: NON_USER }
  ),
  [S.RUNBOOKS_APPROVE]: def(
    S.RUNBOOKS_APPROVE,
    'Runbooks approve',
    'Runbooks',
    'Inspect reviewed step plans and approve or reject waiting execution steps. Requires an execution approver role; read access and resource visibility remain separate.',
    { write: true, issuableBy: OPERATORS }
  ),
  [S.RUNBOOKS_EXECUTE]: def(
    S.RUNBOOKS_EXECUTE,
    'Runbooks execute',
    'Runbooks',
    'Start runbook executions. Linking an execution to an incident also requires `incidents:read` and access to that incident.',
    { write: true }
  ),
  [S.RUNBOOK_RULES_READ]: def(
    S.RUNBOOK_RULES_READ,
    'Runbook rules read',
    'Runbooks',
    'Read administrative service rule configuration, readiness and safe policy-check metadata. Requires an explicit scope and administrator capability.',
    { issuableBy: ADMINS }
  ),
  [S.RUNBOOK_RULES_WRITE]: def(
    S.RUNBOOK_RULES_WRITE,
    'Runbook rules configure',
    'Runbooks',
    'Create, edit, pause, duplicate or detach service runbook rules with revision protection. Requires an explicit scope; automatic activation and policy-check requests require runbook-rules:activate.',
    { write: true, issuableBy: ADMINS }
  ),
  [S.RUNBOOK_RULES_ACTIVATE]: def(
    S.RUNBOOK_RULES_ACTIVATE,
    'Runbook rules activate',
    'Runbooks',
    'Request bounded Agent policy checks and activate reviewed automatic rules. Requires an explicit scope and administrator capability.',
    { write: true, issuableBy: ADMINS }
  ),
  [S.RUNBOOKS_WRITE]: def(
    S.RUNBOOKS_WRITE,
    'Runbooks author',
    'Runbooks',
    'Create runbooks and edit drafts. Requires an explicit scope; publishing requires runbooks:publish.',
    { write: true, issuableBy: ADMINS }
  ),
  [S.RUNBOOKS_PUBLISH]: def(
    S.RUNBOOKS_PUBLISH,
    'Runbooks publish',
    'Runbooks',
    'Publish validated runbook drafts. Must be granted explicitly.',
    { write: true, issuableBy: ADMINS }
  ),
  [S.AUDIT_READ]: def(
    S.AUDIT_READ,
    'Audit logs read',
    'Governance',
    'Read audit log records (details are redacted).',
    { issuableBy: ['ADMIN', 'AUDITOR'] }
  ),
  [S.REPORTS_READ]: def(
    S.REPORTS_READ,
    'Reports read',
    'Governance',
    'Read operational metrics and reports.'
  ),
  [S.POSTMORTEMS_READ]: def(
    S.POSTMORTEMS_READ,
    'Postmortems read',
    'Governance',
    'Read postmortems.'
  ),
  [S.POSTMORTEMS_WRITE]: def(
    S.POSTMORTEMS_WRITE,
    'Postmortems manage',
    'Governance',
    'Create and update postmortems.',
    { write: true }
  ),
  [S.SERVICE_ACCOUNTS_READ]: def(
    S.SERVICE_ACCOUNTS_READ,
    'Service accounts read',
    'Administration',
    'List service accounts and their tokens.',
    { issuableBy: ADMINS }
  ),
  [S.SERVICE_ACCOUNTS_WRITE]: def(
    S.SERVICE_ACCOUNTS_WRITE,
    'Service accounts manage',
    'Administration',
    'Create service accounts and issue or revoke their tokens.',
    { write: true, issuableBy: ADMINS }
  ),
  [S.RESPONSE_POLICY_READ]: def(
    S.RESPONSE_POLICY_READ,
    'Response policy read',
    'Administration',
    'Read response policy through the response-policy API.',
    { issuableBy: ADMINS }
  ),
  [S.RESPONSE_POLICY_WRITE]: def(
    S.RESPONSE_POLICY_WRITE,
    'Response policy write',
    'Administration',
    'Change response policy through the response-policy API.',
    { write: true, issuableBy: ADMINS }
  ),
  [S.ADMIN_MANAGE]: def(
    S.ADMIN_MANAGE,
    'Administrator',
    'Administration',
    'Administrator access to ordinary API operations. Runbook authoring, publishing and execution require explicit scopes.',
    { write: true, issuableBy: ADMINS }
  ),
};

export const ALL_API_SCOPE_DEFINITIONS: readonly ApiScopeDefinition[] =
  Object.values(API_SCOPE_REGISTRY);

export function isScopeIssuable(scope: ApiScope): boolean {
  // eslint-disable-next-line security/detect-object-injection -- lookup key is a fixed literal, a typed enum value or a gated internal name, never a raw request-controlled name
  return API_SCOPE_REGISTRY[scope].status === 'active';
}

/** Scopes a principal with the given role may place on a new credential. */
export function issuableScopesForRole(role: string): ApiScopeDefinition[] {
  return ALL_API_SCOPE_DEFINITIONS.filter(
    definition =>
      definition.status === 'active' && (definition.issuableBy as readonly string[]).includes(role)
  );
}

/** Scopes among `requested` that `role` may not issue (reserved, or outside its role). */
export function disallowedScopesForRole(role: string, requested: readonly ApiScope[]): ApiScope[] {
  const allowed = new Set(issuableScopesForRole(role).map(definition => definition.scope));
  return requested.filter(scope => !allowed.has(scope));
}
