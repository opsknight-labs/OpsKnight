/**
 * Product-wide authorization contract.
 *
 * Roles are stable bundles for administrators and identity-provider mappings.
 * Capabilities are the enforcement primitive used by server guards and UI hints.
 * Resource policies (team membership, assignment, visibility) are evaluated by
 * the server after the role grants the relevant scoped capability.
 */
export const APP_ROLES = ['ADMIN', 'RESPONDER', 'AUDITOR', 'USER'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const CAPABILITIES = {
  ADMIN_MANAGE: 'admin.manage',
  OPERATIONS_MANAGE: 'operations.manage',
  INCIDENT_CREATE_ALL: 'incident.create.all',
  INCIDENT_CREATE_SCOPED: 'incident.create.scoped',
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
  POSTMORTEM_DRAFT_READ: 'postmortem.draft.read',
  REPORT_READ: 'report.read',
  REPORT_EXPORT: 'report.export',
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

export const API_SCOPES = {
  EVENTS_WRITE: 'events:write',
  INCIDENTS_READ: 'incidents:read',
  INCIDENTS_WRITE: 'incidents:write',
  SERVICES_READ: 'services:read',
  SCHEDULES_READ: 'schedules:read',
} as const;

export type ApiScope = (typeof API_SCOPES)[keyof typeof API_SCOPES];

export function isApiScope(value: unknown): value is ApiScope {
  return typeof value === 'string' && Object.values(API_SCOPES).some(scope => scope === value);
}

export function isWriteApiScope(scope: ApiScope): boolean {
  return scope.endsWith(':write');
}

const ADMIN_CAPABILITIES = new Set<Capability>(Object.values(CAPABILITIES));
const RESPONDER_CAPABILITIES = new Set<Capability>([
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
  CAPABILITIES.REPORT_EXPORT,
]);
const AUDITOR_CAPABILITIES = new Set<Capability>([
  CAPABILITIES.INCIDENT_READ_ALL,
  CAPABILITIES.SERVICE_READ_ALL,
  CAPABILITIES.METRICS_READ_ALL,
  CAPABILITIES.SCHEDULE_READ_ALL,
  CAPABILITIES.AUDIT_READ,
  CAPABILITIES.REPORT_READ,
  CAPABILITIES.REPORT_EXPORT,
]);
const USER_CAPABILITIES = new Set<Capability>([
  CAPABILITIES.INCIDENT_CREATE_SCOPED,
  CAPABILITIES.INCIDENT_READ_SCOPED,
  CAPABILITIES.SERVICE_READ_SCOPED,
  CAPABILITIES.METRICS_READ_SCOPED,
  CAPABILITIES.SCHEDULE_READ_SCOPED,
  CAPABILITIES.REPORT_READ,
]);

const ROLE_CAPABILITIES = new Map<AppRole, ReadonlySet<Capability>>([
  ['ADMIN', ADMIN_CAPABILITIES],
  ['RESPONDER', RESPONDER_CAPABILITIES],
  ['AUDITOR', AUDITOR_CAPABILITIES],
  ['USER', USER_CAPABILITIES],
]);

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && APP_ROLES.some(role => role === value);
}

export function getRoleCapabilities(role: AppRole): readonly Capability[] {
  return [...(ROLE_CAPABILITIES.get(role) ?? [])];
}

export function hasCapability(role: AppRole, capability: Capability): boolean {
  return ROLE_CAPABILITIES.get(role)?.has(capability) ?? false;
}

export function roleLabel(role: AppRole): string {
  if (role === 'ADMIN') return 'Admin';
  if (role === 'RESPONDER') return 'Responder';
  if (role === 'AUDITOR') return 'Auditor';
  return 'User';
}

export const ROLE_DESCRIPTIONS = new Map<AppRole, string>([
  ['ADMIN', 'Full organization administration and operational access.'],
  ['RESPONDER', 'Manage incident response and operational workflows.'],
  [
    'AUDITOR',
    'Read-only organization-wide access to incidents, metrics, reports, schedules, and audit evidence.',
  ],
  ['USER', 'Team-scoped access to assigned operational information.'],
]);

export class AuthorizationError extends Error {
  readonly code = 'AUTHORIZATION_DENIED';
  readonly status = 403;

  constructor(
    message: string,
    readonly capability: Capability
  ) {
    super(message);
    this.name = 'AuthorizationError';
  }
}
