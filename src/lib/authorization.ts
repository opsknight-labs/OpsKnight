/**
 * Product-wide authorization contract.
 *
 * Roles are stable bundles for administrators and identity-provider mappings.
 * Capabilities are the enforcement primitive used by server guards and UI hints.
 * Resource policies (team membership, assignment, visibility) are evaluated by
 * the server after the role grants the relevant scoped capability.
 */
import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';

export const APP_ROLES = ['ADMIN', 'RESPONDER', 'AUDITOR', 'USER', 'STAKEHOLDER'] as const;
export type AppRole = (typeof APP_ROLES)[number];
/** Roles an administrator or identity provider can assign. */
export const ASSIGNABLE_ROLES = ['ADMIN', 'RESPONDER', 'AUDITOR', 'USER', 'STAKEHOLDER'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const CAPABILITIES = {
  AUTOMATION_READ: 'automation.read',
  AUTOMATION_EDIT: 'automation.edit',
  AUTOMATION_PUBLISH: 'automation.publish',
  ADMIN_MANAGE: 'admin.manage',
  OPERATIONS_MANAGE: 'operations.manage',
  INCIDENT_CREATE_ALL: 'incident.create.all',
  INCIDENT_CREATE_SCOPED: 'incident.create.scoped',
  INCIDENT_ACKNOWLEDGE_SCOPED: 'incident.acknowledge.scoped',
  INCIDENT_ESCALATE_SCOPED: 'incident.escalate.scoped',
  INCIDENT_NOTE_SCOPED: 'incident.note.scoped',
  INCIDENT_RESOLVE_SCOPED: 'incident.resolve.scoped',
  INCIDENT_READ_ALL: 'incident.read.all',
  INCIDENT_READ_SCOPED: 'incident.read.scoped',
  INCIDENT_EXPORT: 'incident.export',
  INCIDENT_SENSITIVE_READ: 'incident.sensitive.read',
  SERVICE_READ_ALL: 'service.read.all',
  SERVICE_READ_SCOPED: 'service.read.scoped',
  METRICS_READ_ALL: 'metrics.read.all',
  METRICS_READ_SCOPED: 'metrics.read.scoped',
  SCHEDULE_READ_ALL: 'schedule.read.all',
  SCHEDULE_READ_SCOPED: 'schedule.read.scoped',
  AUDIT_READ: 'audit.read',
  AUDIT_EXPORT: 'audit.export',
  POSTMORTEM_DRAFT_READ: 'postmortem.draft.read',
  REPORT_READ: 'report.read',
  /** Create, edit, publish, share, schedule and delete reports, saved views and dashboards. */
  REPORT_MANAGE: 'report.manage',
  REPORT_EXPORT: 'report.export',
  USER_READ_ALL: 'user.read.all',
  USER_NOTIFICATION_PREFERENCES: 'user.notification_preferences',
  TEAM_ADMINISTER_SCOPED: 'team.administer.scoped',
  POLICY_READ_ALL: 'policy.read.all',
  PRIVACY_READ: 'privacy.read',
  PRIVACY_REQUESTS_MANAGE: 'privacy.requests.manage',
  PRIVACY_EXPORT: 'privacy.export',
  PRIVACY_ERASURE: 'privacy.erasure',
  RETENTION_READ: 'retention.read',
  RETENTION_MANAGE: 'retention.manage',
  RETENTION_HOLDS_MANAGE: 'retention.holds.manage',
  ENCRYPTION_READ: 'encryption.read',
  ENCRYPTION_MANAGE: 'encryption.manage',
  COMPLIANCE_READ: 'compliance.read',
  COMPLIANCE_EVALUATE: 'compliance.evaluate',
  COMPLIANCE_EVIDENCE_READ: 'compliance.evidence.read',
  COMPLIANCE_EXPORT: 'compliance.export',
  COMPLIANCE_DRIFT_MANAGE: 'compliance.drift.manage',
  ACCESS_REVIEW_MANAGE: 'access.review.manage',

  // Runbooks
  RUNBOOK_READ_ALL: 'runbook.read.all',
  RUNBOOK_READ_SCOPED: 'runbook.read.scoped',
  RUNBOOK_EXECUTE: 'runbook.execute',
  RUNBOOK_APPROVE: 'runbook.approve',
  RUNBOOK_MANAGE: 'runbook.manage',
  RUNBOOK_ARTIFACT_DOWNLOAD: 'runbook.artifact.download',
  RUNBOOK_PUBLISH: 'runbook.publish',
  RUNBOOK_AGENT_MANAGE: 'runbook.agent.manage',
  RUNBOOK_SECRET_MANAGE: 'runbook.secret.manage',

  // Intelligence (AIOps)
  INTELLIGENCE_READ: 'intelligence.read',
  /** End-user suggestions on incidents; every result is still filtered by incident visibility. */
  INTELLIGENCE_SUGGESTIONS_READ: 'intelligence.suggestions.read',
  INTELLIGENCE_FEEDBACK: 'intelligence.feedback',
  INTELLIGENCE_MANAGE: 'intelligence.manage',
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

export const API_SCOPES = {
  EVENTS_WRITE: 'events:write',
  INCIDENTS_READ: 'incidents:read',
  INCIDENTS_WRITE: 'incidents:write',
  SERVICES_READ: 'services:read',
  SERVICES_WRITE: 'services:write',
  SCHEDULES_READ: 'schedules:read',
  SCHEDULES_WRITE: 'schedules:write',
  TEAMS_READ: 'teams:read',
  TEAMS_WRITE: 'teams:write',
  USERS_READ: 'users:read',
  USERS_WRITE: 'users:write',
  ESCALATION_POLICIES_READ: 'escalation-policies:read',
  ESCALATION_POLICIES_WRITE: 'escalation-policies:write',
  INTEGRATIONS_READ: 'integrations:read',
  INTEGRATIONS_WRITE: 'integrations:write',
  INTEGRATIONS_CREATE: 'integrations:create',
  INTEGRATIONS_CREDENTIALS_WRITE: 'integrations:credentials:write',
  INTEGRATIONS_TEST: 'integrations:test',
  INTEGRATIONS_DELETE: 'integrations:delete',
  NOTIFICATIONS_READ: 'notifications:read',
  NOTIFICATIONS_WRITE: 'notifications:write',
  NOTIFICATION_PREFERENCES_READ: 'notification-preferences:read',
  NOTIFICATION_PREFERENCES_WRITE: 'notification-preferences:write',
  NOTIFICATION_PROVIDERS_READ: 'notification-providers:read',
  NOTIFICATION_PROVIDERS_WRITE: 'notification-providers:write',
  NOTIFICATION_PROVIDERS_TEST: 'notification-providers:test',
  STATUS_PAGES_READ: 'status-pages:read',
  STATUS_PAGES_WRITE: 'status-pages:write',
  AUTOMATION_READ: 'automation:read',
  AUTOMATION_WRITE: 'automation:write',
  AUTOMATION_PUBLISH: 'automation:publish',
  AUTOMATION_SETTINGS_READ: 'automation-settings:read',
  AUTOMATION_SETTINGS_WRITE: 'automation-settings:write',
  STATUS_PAGE_SUBSCRIBERS_READ: 'status-page-subscribers:read',
  STATUS_PAGE_SUBSCRIBERS_WRITE: 'status-page-subscribers:write',
  RUNBOOK_RULES_READ: 'runbook-rules:read',
  RUNBOOK_RULES_WRITE: 'runbook-rules:write',
  RUNBOOK_RULES_ACTIVATE: 'runbook-rules:activate',
  RUNBOOK_AGENTS_WRITE: 'runbook-agents:write',
  RUNBOOK_AGENT_POOLS_WRITE: 'runbook-agent-pools:write',
  RUNBOOK_SECRETS_READ: 'runbook-secrets:read',
  RUNBOOK_SECRETS_WRITE: 'runbook-secrets:write',
  RUNBOOK_SECRETS_GRANT: 'runbook-secrets:grant',
  RUNBOOK_SIGNING_READ: 'runbook-signing:read',
  RUNBOOK_SIGNING_WRITE: 'runbook-signing:write',
  RUNBOOK_SETTINGS_READ: 'runbook-settings:read',
  RUNBOOK_SETTINGS_WRITE: 'runbook-settings:write',
  RUNBOOK_AGENTS_READ: 'runbook-agents:read',
  RUNBOOK_AGENTS_ENROLL: 'runbook-agents:enroll',
  RUNBOOK_AGENTS_REVOKE: 'runbook-agents:revoke',
  RUNBOOKS_READ: 'runbooks:read',
  RUNBOOKS_EXECUTE: 'runbooks:execute',
  RUNBOOKS_APPROVE: 'runbooks:approve',
  RUNBOOKS_WRITE: 'runbooks:write',
  RUNBOOKS_PUBLISH: 'runbooks:publish',
  AUDIT_READ: 'audit:read',
  AUDIT_EXPORT: 'audit:export',
  CUSTOM_FIELDS_READ: 'custom-fields:read',
  CUSTOM_FIELDS_WRITE: 'custom-fields:write',
  CHATOPS_READ: 'chatops:read',
  CHATOPS_WRITE: 'chatops:write',
  REPORTS_READ: 'reports:read',
  REPORTS_WRITE: 'reports:write',
  SERVICE_OBJECTIVES_READ: 'service-objectives:read',
  SERVICE_OBJECTIVES_WRITE: 'service-objectives:write',
  SERVICE_OBJECTIVES_EVALUATE: 'service-objectives:evaluate',
  POSTMORTEMS_READ: 'postmortems:read',
  POSTMORTEMS_WRITE: 'postmortems:write',
  SERVICE_ACCOUNTS_READ: 'service-accounts:read',
  SERVICE_ACCOUNTS_WRITE: 'service-accounts:write',
  RESPONSE_POLICY_READ: 'response-policy:read',
  RESPONSE_POLICY_WRITE: 'response-policy:write',
  ADMIN_MANAGE: 'admin:manage',
} as const;

/** Infrastructure permissions are never implied by a broad administrator credential. */
export const EXPLICIT_API_SCOPES: ReadonlySet<string> = new Set([
  API_SCOPES.USERS_WRITE,
  API_SCOPES.NOTIFICATION_PREFERENCES_READ,
  API_SCOPES.NOTIFICATION_PREFERENCES_WRITE,
  API_SCOPES.NOTIFICATION_PROVIDERS_READ,
  API_SCOPES.NOTIFICATION_PROVIDERS_WRITE,
  API_SCOPES.NOTIFICATION_PROVIDERS_TEST,
  API_SCOPES.INTEGRATIONS_CREATE,
  API_SCOPES.INTEGRATIONS_CREDENTIALS_WRITE,
  API_SCOPES.INTEGRATIONS_TEST,
  API_SCOPES.INTEGRATIONS_DELETE,
  API_SCOPES.AUTOMATION_READ,
  API_SCOPES.AUTOMATION_WRITE,
  API_SCOPES.AUTOMATION_PUBLISH,
  API_SCOPES.AUTOMATION_SETTINGS_READ,
  API_SCOPES.AUTOMATION_SETTINGS_WRITE,
  API_SCOPES.STATUS_PAGE_SUBSCRIBERS_READ,
  API_SCOPES.STATUS_PAGE_SUBSCRIBERS_WRITE,
  API_SCOPES.RUNBOOK_RULES_READ,
  API_SCOPES.RUNBOOK_RULES_WRITE,
  API_SCOPES.RUNBOOK_RULES_ACTIVATE,
  API_SCOPES.RUNBOOK_AGENTS_WRITE,
  API_SCOPES.RUNBOOK_AGENT_POOLS_WRITE,
  API_SCOPES.RUNBOOK_SECRETS_READ,
  API_SCOPES.RUNBOOK_SECRETS_WRITE,
  API_SCOPES.RUNBOOK_SECRETS_GRANT,
  API_SCOPES.RUNBOOK_SIGNING_READ,
  API_SCOPES.RUNBOOK_SIGNING_WRITE,
  API_SCOPES.RUNBOOK_SETTINGS_READ,
  API_SCOPES.RUNBOOK_SETTINGS_WRITE,
  API_SCOPES.RUNBOOK_AGENTS_READ,
  API_SCOPES.RUNBOOK_AGENTS_ENROLL,
  API_SCOPES.RUNBOOK_AGENTS_REVOKE,
  API_SCOPES.RUNBOOKS_WRITE,
  API_SCOPES.RUNBOOKS_PUBLISH,
  API_SCOPES.RUNBOOKS_EXECUTE,
  API_SCOPES.RUNBOOKS_APPROVE,
  API_SCOPES.SERVICE_OBJECTIVES_READ,
  API_SCOPES.SERVICE_OBJECTIVES_WRITE,
  API_SCOPES.SERVICE_OBJECTIVES_EVALUATE,
]);

export type ApiScope = (typeof API_SCOPES)[keyof typeof API_SCOPES];

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === 'string' && Object.values(API_SCOPES).some(scope => scope === value);
}

export function isWriteApiScope(scope: ApiScope): boolean {
  return (
    scope.endsWith(':write') ||
    scope.endsWith(':execute') ||
    scope.endsWith(':publish') ||
    scope.endsWith(':test') ||
    scope === 'admin:manage'
  );
}

const ADMIN_CAPABILITIES = new Set<Capability>(Object.values(CAPABILITIES));
const RESPONDER_CAPABILITIES = new Set<Capability>([
  CAPABILITIES.USER_NOTIFICATION_PREFERENCES,
  CAPABILITIES.TEAM_ADMINISTER_SCOPED,
  CAPABILITIES.AUTOMATION_READ,
  CAPABILITIES.AUTOMATION_EDIT,
  CAPABILITIES.OPERATIONS_MANAGE,
  CAPABILITIES.INCIDENT_CREATE_ALL,
  CAPABILITIES.INCIDENT_READ_ALL,
  CAPABILITIES.INCIDENT_EXPORT,
  CAPABILITIES.INCIDENT_SENSITIVE_READ,
  CAPABILITIES.SERVICE_READ_ALL,
  CAPABILITIES.METRICS_READ_ALL,
  CAPABILITIES.SCHEDULE_READ_ALL,
  CAPABILITIES.POSTMORTEM_DRAFT_READ,
  CAPABILITIES.REPORT_READ,
  CAPABILITIES.REPORT_MANAGE,
  CAPABILITIES.REPORT_EXPORT,
  CAPABILITIES.USER_READ_ALL,
  CAPABILITIES.POLICY_READ_ALL,
  // Runbooks: responders can view, execute, and approve published runbooks
  CAPABILITIES.RUNBOOK_READ_ALL,
  CAPABILITIES.RUNBOOK_EXECUTE,
  CAPABILITIES.RUNBOOK_APPROVE,
  // Intelligence: responders may view findings and give feedback; policy changes stay admin-only.
  CAPABILITIES.INTELLIGENCE_READ,
  CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ,
  CAPABILITIES.INTELLIGENCE_FEEDBACK,
]);
const AUDITOR_CAPABILITIES = new Set<Capability>([
  CAPABILITIES.USER_NOTIFICATION_PREFERENCES,
  CAPABILITIES.AUTOMATION_READ,
  CAPABILITIES.INCIDENT_READ_ALL,
  CAPABILITIES.SERVICE_READ_ALL,
  CAPABILITIES.METRICS_READ_ALL,
  CAPABILITIES.SCHEDULE_READ_ALL,
  CAPABILITIES.AUDIT_READ,
  CAPABILITIES.AUDIT_EXPORT,
  // Auditors read and export reports but never create, change or delete them.
  CAPABILITIES.REPORT_READ,
  CAPABILITIES.REPORT_EXPORT,
  CAPABILITIES.USER_READ_ALL,
  CAPABILITIES.POLICY_READ_ALL,
  // Auditors may view privacy request state but never export or modify it.
  CAPABILITIES.PRIVACY_READ,
  // Auditors may view retention settings and cleanup previews.
  CAPABILITIES.RETENTION_READ,
  // Auditors may inspect encryption migration status and key retirement readiness.
  CAPABILITIES.ENCRYPTION_READ,
  // Auditors may inspect compliance controls and runtime evaluation state.
  CAPABILITIES.COMPLIANCE_READ,
  // Auditors may inspect immutable compliance evidence snapshots.
  CAPABILITIES.COMPLIANCE_EVIDENCE_READ,
  // Auditors may export verifiable audit evidence packages.
  CAPABILITIES.COMPLIANCE_EXPORT,
  // Auditors may view runbook definitions and execution history.
  CAPABILITIES.RUNBOOK_READ_ALL,
  // Auditors may inspect intelligence decisions and explanations but never change them.
  CAPABILITIES.INTELLIGENCE_READ,
  CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ,
]);
const USER_CAPABILITIES = new Set<Capability>([
  CAPABILITIES.USER_NOTIFICATION_PREFERENCES,
  // Scoped users may see suggestions, but only for incidents they can already read.
  CAPABILITIES.INTELLIGENCE_SUGGESTIONS_READ,
  // And may rate them; feedback is visibility-checked, rate-limited and one live verdict per person.
  CAPABILITIES.INTELLIGENCE_FEEDBACK,
  CAPABILITIES.TEAM_ADMINISTER_SCOPED,
  CAPABILITIES.INCIDENT_READ_SCOPED,
  // Whoever is paged must be able to work the incident: acknowledge, add notes, escalate and
  // resolve incidents assigned to them, on their teams' services, or where they are on call.
  CAPABILITIES.INCIDENT_ACKNOWLEDGE_SCOPED,
  CAPABILITIES.INCIDENT_NOTE_SCOPED,
  CAPABILITIES.INCIDENT_ESCALATE_SCOPED,
  CAPABILITIES.INCIDENT_RESOLVE_SCOPED,
  CAPABILITIES.SERVICE_READ_SCOPED,
  CAPABILITIES.METRICS_READ_SCOPED,
  CAPABILITIES.SCHEDULE_READ_SCOPED,
  CAPABILITIES.REPORT_READ,
  CAPABILITIES.REPORT_MANAGE,
]);

// Business-impact audience: the status dashboard (open to everyone signed in), business services
// in their teams (follow them for impact updates) and their own profile and notification
// preferences. Never reads incidents and is never paged: see isPageableRole.
const STAKEHOLDER_CAPABILITIES = new Set<Capability>([
  CAPABILITIES.USER_NOTIFICATION_PREFERENCES,
  CAPABILITIES.SERVICE_READ_SCOPED,
]);

const ROLE_CAPABILITIES = new Map<AppRole, ReadonlySet<Capability>>([
  ['ADMIN', ADMIN_CAPABILITIES],
  ['RESPONDER', RESPONDER_CAPABILITIES],
  ['AUDITOR', AUDITOR_CAPABILITIES],
  ['USER', USER_CAPABILITIES],
  ['STAKEHOLDER', STAKEHOLDER_CAPABILITIES],
]);

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && APP_ROLES.some(role => role === value);
}

export function isAssignableRole(value: unknown): value is AssignableRole {
  return typeof value === 'string' && ASSIGNABLE_ROLES.some(role => role === value);
}

/**
 * Whether people with this role may be paged: escalation targets, on-call layers and overrides,
 * team escalation recipients and incident assignees. Stakeholders never are.
 */
export function isPageableRole(role: string): boolean {
  return role !== 'STAKEHOLDER';
}

/** Prisma filter for people who may be paged (see isPageableRole), for target pickers. */
export const PAGEABLE_USER_WHERE = {
  role: { not: 'STAKEHOLDER' },
} as const satisfies Prisma.UserWhereInput;

/**
 * The one guard for anything that pages someone or makes them responsible for an incident:
 * escalation targets, on-call layers and overrides, incident assignees and incident roles.
 */
export function assertPageableUser(user: { role: string; name?: string | null }): void {
  if (isPageableRole(user.role)) return;
  throw new AppError({
    code: 'VALIDATION_FAILED',
    userMessage: `${user.name || 'This person'} is a stakeholder. Stakeholders are never paged, so they cannot be on call, an escalation target, or assigned to an incident.`,
  });
}

export function getRoleCapabilities(role: AppRole): readonly Capability[] {
  return [...(ROLE_CAPABILITIES.get(role) ?? [])];
}

export function hasCapability(role: AppRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES.get(role)?.has(capability) ?? false;
}

/** Whether a role value (an account's, or one being assigned) is a role that holds admin.manage. */
export function isAdministratorRole(role: unknown): boolean {
  return isAppRole(role) && hasCapability(role, CAPABILITIES.ADMIN_MANAGE);
}

/**
 * Whether `current` already includes every permission of `requested`. Built-in roles are not a
 * strict ladder (Auditors hold audit and compliance permissions Responders lack), so compare
 * permission sets rather than rank.
 */
export function roleCovers(
  current: string | null | undefined,
  requested: string | null | undefined
): boolean {
  if (!isAppRole(current) || !isAppRole(requested)) return false;
  const held = new Set(getRoleCapabilities(current));
  return getRoleCapabilities(requested).every(capability => held.has(capability));
}

const PERMANENT_UPGRADE_LADDER: readonly string[] = ['STAKEHOLDER', 'USER', 'RESPONDER', 'ADMIN'];

/**
 * Whether permanently replacing `current` with `requested` keeps everything the person can do.
 * A permanent approval swaps the base role (there is no permanent additive grant), so a lateral
 * move such as USER or RESPONDER to AUDITOR would silently strip their working permissions;
 * those can only be granted time-boxed, where the grant is added on top of the base role.
 * Responder's all-incident permissions supersede a User's scoped ones even though the sets differ,
 * so a step up the operations ladder counts as safe alongside a strict permission superset.
 */
export function permanentRoleKeepsAccess(
  current: string | null | undefined,
  requested: string | null | undefined
): boolean {
  if (roleCovers(requested, current)) return true;
  const from = PERMANENT_UPGRADE_LADDER.indexOf(current ?? '');
  const to = PERMANENT_UPGRADE_LADDER.indexOf(requested ?? '');
  return from >= 0 && to > from;
}

/** Effective permissions of a resolved user; falls back to the built-in role's permissions. */
export function capabilitiesOf(user: {
  role: string;
  capabilities?: readonly Capability[];
}): readonly Capability[] {
  if (user.capabilities) return user.capabilities;
  return isAppRole(user.role) ? getRoleCapabilities(user.role) : [];
}

export function isCapability(value: unknown): value is Capability {
  return typeof value === 'string' && ALL_CAPABILITIES.has(value as Capability);
}

const ALL_CAPABILITIES: ReadonlySet<Capability> = new Set(Object.values(CAPABILITIES));

/**
 * Capabilities that are never granted through custom roles or temporary grants: they are the
 * definition of the Admin role and must stay tied to an explicit, audited role assignment.
 */
export const NON_DELEGABLE_CAPABILITIES: ReadonlySet<Capability> = new Set([
  CAPABILITIES.ADMIN_MANAGE,
]);

/**
 * The effective permission set of a person: their base role, plus any custom role and
 * active temporary grants layered on top. Additional sets can only add permissions.
 */
export function effectiveCapabilities(
  role: AppRole,
  ...additional: readonly (readonly Capability[] | undefined | null)[]
): ReadonlySet<Capability> {
  const set = new Set<Capability>(ROLE_CAPABILITIES.get(role) ?? []);
  for (const extra of additional) {
    for (const capability of extra ?? []) {
      if (isCapability(capability) && !NON_DELEGABLE_CAPABILITIES.has(capability)) {
        set.add(capability);
      }
    }
  }
  return set;
}

export function roleLabel(role: AppRole): string {
  if (role === 'ADMIN') return 'Admin';
  if (role === 'RESPONDER') return 'Responder';
  if (role === 'AUDITOR') return 'Auditor';
  if (role === 'STAKEHOLDER') return 'Stakeholder';
  return 'User';
}

export const ROLE_DESCRIPTIONS = new Map<AppRole, string>([
  ['ADMIN', 'Full organization administration and operational access.'],
  ['RESPONDER', 'Manage incident response and operational workflows.'],
  [
    'AUDITOR',
    'Read-only organization-wide access to incidents, metrics, reports, schedules, and audit evidence.',
  ],
  [
    'USER',
    'Access to incidents and services in your teams, plus incidents assigned to or watched by you. Can acknowledge, update, escalate and resolve those incidents. Team owners and team admins can manage their own teams.',
  ],
  [
    'STAKEHOLDER',
    'Business-impact view only: the status dashboard and business services in your teams, which they can follow for impact updates. No incident access. Never paged.',
  ],
]);

export class AuthorizationError extends AppError {
  constructor(
    message: string,
    readonly capability: Capability
  ) {
    super({
      code: 'AUTHORIZATION_DENIED',
      userMessage: message,
      details: { capability },
    });
    this.name = 'AuthorizationError';
  }
}
