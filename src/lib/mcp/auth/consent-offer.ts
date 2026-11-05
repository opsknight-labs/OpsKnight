import type { AppRole } from '@/lib/authorization';
import { describeMcpScope } from './scopes';
import { partitionScopesForRole } from './role-scopes';

export type McpConsentScope = {
  scope: string;
  label: string;
  /** Pre-selected when the page opens. */
  checked: boolean;
  /** Not part of the connection this consent replaces: what an upgrade adds. */
  added?: boolean;
};

export type McpConsentGroup = {
  id: string;
  label: string;
  /** Read-only scopes. */
  view: McpConsentScope[];
  /** Scopes that can change something: write, execute, approve, publish, delete and so on. */
  change: McpConsentScope[];
};

export type McpConsentOffer = {
  groups: McpConsentGroup[];
  /** Every scope shown as a checkbox, in request order. The only scopes a consent may grant. */
  offered: string[];
  /** Requested scopes this role can never use; never shown as checkboxes. */
  unavailable: string[];
};

/** Areas in display order. A scope's resource (the part before `:`) decides its area. */
const AREAS: { id: string; label: string; resources: string[] }[] = [
  { id: 'incidents', label: 'Incidents', resources: ['incidents', 'events', 'postmortems'] },
  {
    id: 'services',
    label: 'Services',
    resources: ['services', 'service-objectives', 'integrations'],
  },
  {
    id: 'on-call',
    label: 'Schedules and escalation',
    resources: ['schedules', 'escalation-policies', 'notifications'],
  },
  {
    id: 'runbooks',
    label: 'Runbooks',
    resources: ['runbooks', 'runbook-rules', 'runbook-settings'],
  },
  { id: 'automation', label: 'Automation', resources: ['automation', 'automation-settings'] },
  {
    id: 'status-pages',
    label: 'Status pages',
    resources: ['status-pages', 'status-page-subscribers'],
  },
  { id: 'people', label: 'Teams and people', resources: ['teams', 'users'] },
  { id: 'reporting', label: 'Reports and audit', resources: ['reports', 'audit'] },
  {
    id: 'settings',
    label: 'Settings',
    resources: ['custom-fields', 'chatops', 'response-policy'],
  },
];
const OTHER = { id: 'other', label: 'Other' };
const AREA_BY_RESOURCE = new Map(
  AREAS.flatMap(area => area.resources.map(resource => [resource, area.id] as const))
);

/** Only `:read` scopes are view-only; anything else can change data or trigger an action. */
export function isMcpViewScope(scope: string) {
  return scope.endsWith(':read');
}

/**
 * What the consent page offers this person, and what it pre-selects.
 *
 * `scopes` is the pending request (assistant request ∩ client/policy ceiling). Scopes the role
 * cannot exercise are dropped. Requested read scopes start selected; a scope that can change
 * something starts selected only when the assistant explicitly asked for it or the connection
 * being replaced already had it.
 */
export function buildMcpConsentOffer(input: {
  scopes: readonly string[];
  explicitlyRequested: readonly string[];
  role: AppRole;
  /** Scopes of the connection this consent replaces; they start selected again. */
  previouslyGranted?: readonly string[];
  /** The policy requires view-only connections: only read scopes are offered. */
  readOnly?: boolean;
}): McpConsentOffer {
  const partition = partitionScopesForRole(input.scopes, input.role);
  const { unavailable } = partition;
  const offered = input.readOnly ? partition.offered.filter(isMcpViewScope) : partition.offered;
  const previous = input.previouslyGranted ?? [];
  const explicit = new Set([...input.explicitlyRequested, ...previous]);
  const groups = new Map<string, McpConsentGroup>(
    [...AREAS, OTHER].map(area => [
      area.id,
      { id: area.id, label: area.label, view: [], change: [] },
    ])
  );
  // Within an area, list its primary resource first (services before integrations), then by name.
  const rank = (scope: string) => {
    const resource = scope.split(':')[0];
    const area = AREAS.find(candidate => candidate.resources.includes(resource));
    return area ? area.resources.indexOf(resource) : 0;
  };
  const ordered = [...offered].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  for (const scope of ordered) {
    const area = AREA_BY_RESOURCE.get(scope.split(':')[0]) ?? OTHER.id;
    const group = groups.get(area)!;
    const view = isMcpViewScope(scope);
    (view ? group.view : group.change).push({
      scope,
      label: describeMcpScope(scope),
      checked: view || explicit.has(scope),
      // Only an upgrade of an existing connection has anything to mark as new.
      ...(previous.length && !previous.includes(scope) ? { added: true } : {}),
    });
  }
  return {
    groups: [...groups.values()].filter(group => group.view.length + group.change.length > 0),
    offered,
    unavailable,
  };
}
