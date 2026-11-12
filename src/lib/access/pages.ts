/**
 * Single source of truth for page-level access. Used by:
 *  - server page guards (`requirePageAccess`)
 *  - every navigation surface (sidebar, settings nav, mobile, command palette)
 *  - the 403 Access denied page, to explain what is required and who can grant it
 *  - a CI contract test that fails when a page has no rule
 *
 * Client-safe: depends only on capability constants.
 */
import { CAPABILITIES, type Capability } from '@/lib/authorization';

const C = CAPABILITIES;

/** Who can grant access when the rule denies someone. */
export type AccessGrantor = 'org_admin' | 'team_owner';

/** Resource type behind a dynamic segment; resource-level checks run inside the page. */
export type AccessResourceType =
  | 'incident'
  | 'service'
  | 'team'
  | 'schedule'
  | 'policy'
  | 'postmortem'
  | 'runbook'
  | 'report'
  | 'user'
  | 'status_page';

export type PageAccessRule = {
  /** Route pattern. `[param]` matches one segment. Matching is by longest pattern prefix. */
  pattern: string;
  label: string;
  /** Any one of these grants access. Omit for pages available to every signed-in person. */
  anyOf?: readonly Capability[];
  grantor?: AccessGrantor;
  resource?: AccessResourceType;
};

const INCIDENT_READ = [C.INCIDENT_READ_ALL, C.INCIDENT_READ_SCOPED] as const;
const SERVICE_READ = [C.SERVICE_READ_ALL, C.SERVICE_READ_SCOPED] as const;
const SCHEDULE_READ = [C.SCHEDULE_READ_ALL, C.SCHEDULE_READ_SCOPED] as const;
const ADMIN = [C.ADMIN_MANAGE] as const;

export const PAGE_ACCESS: readonly PageAccessRule[] = [
  { pattern: '/', label: 'Dashboard' },
  { pattern: '/action-items', label: 'Action items' },
  { pattern: '/analytics', label: 'Analytics', anyOf: [C.REPORT_READ] },
  { pattern: '/audit', label: 'Audit log', anyOf: [C.AUDIT_READ] },
  { pattern: '/events', label: 'Event ingestion', anyOf: ADMIN },
  { pattern: '/help', label: 'Help' },
  { pattern: '/shortcuts', label: 'Keyboard shortcuts' },

  { pattern: '/incidents', label: 'Incidents', anyOf: INCIDENT_READ },
  { pattern: '/incidents/[id]', label: 'Incident', anyOf: INCIDENT_READ, resource: 'incident' },
  {
    pattern: '/incidents/create',
    label: 'Create incident',
    anyOf: [C.INCIDENT_CREATE_ALL, C.INCIDENT_CREATE_SCOPED],
  },
  { pattern: '/incidents/templates', label: 'Incident templates', anyOf: INCIDENT_READ },
  {
    pattern: '/incidents/templates/create',
    label: 'Create incident template',
    anyOf: [C.OPERATIONS_MANAGE],
  },

  { pattern: '/postmortems', label: 'Postmortems', anyOf: INCIDENT_READ },
  {
    pattern: '/postmortems/[incidentId]',
    label: 'Postmortem',
    anyOf: INCIDENT_READ,
    resource: 'postmortem',
  },
  { pattern: '/postmortems/create', label: 'Create postmortem', anyOf: [C.OPERATIONS_MANAGE] },

  { pattern: '/services', label: 'Services', anyOf: SERVICE_READ },
  { pattern: '/services/[id]', label: 'Service', anyOf: SERVICE_READ, resource: 'service' },
  {
    pattern: '/services/[id]/webhooks',
    label: 'Service webhooks',
    anyOf: [C.OPERATIONS_MANAGE],
    resource: 'service',
    grantor: 'team_owner',
  },

  { pattern: '/schedules', label: 'On-call schedules', anyOf: SCHEDULE_READ },
  { pattern: '/schedules/[id]', label: 'Schedule', anyOf: SCHEDULE_READ, resource: 'schedule' },

  { pattern: '/policies', label: 'Escalation policies', anyOf: [C.POLICY_READ_ALL] },
  {
    pattern: '/policies/[id]',
    label: 'Escalation policy',
    anyOf: [C.POLICY_READ_ALL],
    resource: 'policy',
  },
  { pattern: '/policies/create', label: 'Create escalation policy', anyOf: ADMIN },

  { pattern: '/teams', label: 'Teams' },
  { pattern: '/teams/[id]', label: 'Team', resource: 'team', grantor: 'team_owner' },
  { pattern: '/users', label: 'Users', anyOf: [C.USER_READ_ALL] },
  { pattern: '/users/[id]', label: 'User', anyOf: [C.USER_READ_ALL], resource: 'user' },

  { pattern: '/reports', label: 'Reports', anyOf: [C.REPORT_READ] },
  {
    pattern: '/reports/executive/[id]',
    label: 'Executive dashboard',
    anyOf: [C.REPORT_READ],
    resource: 'report',
  },

  { pattern: '/runbooks', label: 'Runbooks', anyOf: [C.RUNBOOK_READ_ALL] },
  {
    pattern: '/runbooks/[id]',
    label: 'Runbook',
    anyOf: [C.RUNBOOK_READ_ALL],
    resource: 'runbook',
  },
  {
    pattern: '/runbooks/agents/[id]/setup',
    label: 'Runbook agent setup',
    anyOf: [C.RUNBOOK_AGENT_MANAGE],
  },
  {
    pattern: '/runbooks/agents/secrets',
    label: 'Runbook secrets',
    anyOf: [C.RUNBOOK_SECRET_MANAGE],
  },

  { pattern: '/system-logs', label: 'System logs', anyOf: ADMIN },

  { pattern: '/settings', label: 'Settings' },
  { pattern: '/settings/profile', label: 'Profile' },
  { pattern: '/settings/api-keys', label: 'API keys' },
  { pattern: '/settings/chatops/link', label: 'Link chat account' },
  { pattern: '/settings/security', label: 'Security' },
  { pattern: '/settings/notifications/history', label: 'Notification history' },
  { pattern: '/settings/integrations', label: 'Integrations', anyOf: ADMIN },
  { pattern: '/settings/integrations/mcp', label: 'AI assistants (MCP)' },
  { pattern: '/settings/notifications', label: 'Notification providers', anyOf: ADMIN },
  {
    pattern: '/settings/notifications/operations',
    label: 'Notification operations',
    anyOf: [C.ADMIN_MANAGE, C.AUDIT_READ],
  },
  { pattern: '/settings/custom-fields', label: 'Custom fields', anyOf: ADMIN },
  { pattern: '/settings/incident-sla', label: 'Incident SLAs', anyOf: ADMIN },
  { pattern: '/settings/privacy-requests', label: 'Privacy requests', anyOf: [C.PRIVACY_READ] },
  {
    pattern: '/settings/security-compliance',
    label: 'Security & compliance',
    anyOf: [C.COMPLIANCE_READ],
  },
  { pattern: '/settings/service-objectives', label: 'Service objectives' },
  { pattern: '/settings/status-page', label: 'Status page' },
  { pattern: '/settings/status-pages', label: 'Status pages', anyOf: ADMIN },
  { pattern: '/settings/system', label: 'System', anyOf: ADMIN },
  // Recovery must stay reachable from an emergency session; the page enforces its own checks.
  { pattern: '/settings/system/emergency', label: 'Emergency access' },

  { pattern: '/settings/access', label: 'My access' },
  {
    pattern: '/settings/access/admin',
    label: 'Access management',
    anyOf: [C.ADMIN_MANAGE, C.ACCESS_REVIEW_MANAGE],
  },
  { pattern: '/settings/access/requests', label: 'Access requests' },
];

function splitPath(path: string): string[] {
  return path.split('?')[0].split('#')[0].split('/').filter(Boolean);
}

function patternMatchesPrefix(pattern: string[], path: string[]): boolean {
  if (pattern.length > path.length) return false;
  return pattern.every(
    (segment, index) =>
      segment.startsWith('[') || segment === decodeURIComponent(path.at(index) ?? '')
  );
}

/** Longest matching rule for `pathname`, or undefined if no rule matches. */
export function resolvePageAccess(pathname: string): PageAccessRule | undefined {
  const raw = splitPath(pathname);
  // Mobile routes (/m/...) mirror desktop routes and share their rules.
  const path = raw[0] === 'm' ? raw.slice(1) : raw;
  let best: { rule: PageAccessRule; score: number } | undefined;
  for (const rule of PAGE_ACCESS) {
    const pattern = splitPath(rule.pattern);
    if (!patternMatchesPrefix(pattern, path)) continue;
    // Literal segments outrank parameters so `/incidents/create` beats `/incidents/[id]`.
    const score = pattern.length * 10 + pattern.filter(segment => !segment.startsWith('[')).length;
    if (!best || score > best.score) best = { rule, score };
  }
  return best?.rule;
}

export function ruleAllows(
  rule: PageAccessRule | undefined,
  capabilities: ReadonlySet<Capability> | readonly Capability[]
): boolean {
  if (!rule?.anyOf || rule.anyOf.length === 0) return true;
  const has = (capability: Capability) =>
    Array.isArray(capabilities)
      ? capabilities.includes(capability)
      : (capabilities as ReadonlySet<Capability>).has(capability);
  return rule.anyOf.some(has);
}

/** Whether someone with `capabilities` may open `pathname` (page-level rule only). */
export function canAccessPath(
  pathname: string,
  capabilities: ReadonlySet<Capability> | readonly Capability[]
): boolean {
  return ruleAllows(resolvePageAccess(pathname), capabilities);
}
