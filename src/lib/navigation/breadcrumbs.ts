/**
 * Breadcrumb model for console (app) routes: readable labels for every segment, entity names
 * when the page has published them, and links only to segments that are real pages.
 */

/**
 * Every page under `src/app/(app)`. A crumb links only when its path is one of these (dynamic
 * segments as `[param]`); intermediate segments without a page render as plain text.
 * `tests/lib/navigation/breadcrumbs.test.ts` keeps this list in sync with the file system.
 */
export const APP_ROUTE_PATTERNS = [
  '/',
  '/action-items',
  '/analytics',
  '/audit',
  '/events',
  '/events/test',
  '/help',
  '/incidents',
  '/incidents/[id]',
  '/incidents/create',
  '/incidents/templates',
  '/incidents/templates/create',
  '/policies',
  '/policies/[id]',
  '/policies/create',
  '/postmortems',
  '/postmortems/[incidentId]',
  '/postmortems/create',
  '/reports',
  '/reports/executive',
  '/reports/executive/[id]',
  '/reports/executive/new',
  '/runbooks',
  '/runbooks/[id]',
  '/runbooks/[id]/compare',
  '/runbooks/agents',
  '/runbooks/agents/[id]/setup',
  '/runbooks/agents/pools',
  '/runbooks/agents/secrets',
  '/runbooks/agents/security',
  '/runbooks/executions',
  '/runbooks/executions/[id]',
  '/runbooks/health',
  '/schedules',
  '/schedules/[id]',
  '/services',
  '/services/[id]',
  '/services/[id]/automations/[ruleId]',
  '/services/[id]/integrations',
  '/services/[id]/notifications',
  '/services/[id]/settings',
  '/services/[id]/webhooks/[webhookId]/edit',
  '/services/[id]/webhooks/new',
  '/settings',
  '/settings/access',
  '/settings/access/admin',
  '/settings/access/requests',
  '/settings/api-keys',
  '/settings/chatops/link',
  '/settings/custom-fields',
  '/settings/incident-sla',
  '/settings/integrations',
  '/settings/integrations/chatops',
  '/settings/integrations/jira',
  '/settings/integrations/mcp',
  '/settings/integrations/mcp/approvals/[id]',
  '/settings/integrations/mcp/approvals/operations/[id]',
  '/settings/integrations/mcp/assistants/[id]',
  '/settings/integrations/mcp/consent',
  '/settings/integrations/microsoft-teams',
  '/settings/integrations/slack',
  '/settings/notifications',
  '/settings/notifications/history',
  '/settings/notifications/operations',
  '/settings/privacy-requests',
  '/settings/profile',
  '/settings/security',
  '/settings/security-compliance',
  '/settings/service-objectives',
  '/settings/status-page',
  '/settings/status-pages',
  '/settings/status-pages/[pageId]',
  '/settings/system',
  '/settings/system/emergency',
  '/settings/system/health',
  '/settings/system/performance',
  '/shortcuts',
  '/system-logs',
  '/teams',
  '/teams/[id]',
  '/users',
  '/users/[id]',
] as const;

const SEGMENT_LABELS = new Map<string, string>([
  ['access', 'Access'],
  ['action-items', 'Action Items'],
  ['admin', 'Admin'],
  ['agents', 'Agents'],
  ['analytics', 'Analytics'],
  ['api-keys', 'API Keys'],
  ['approvals', 'Approvals'],
  ['assistants', 'Assistants'],
  ['audit', 'Audit Log'],
  ['automations', 'Automations'],
  ['chatops', 'ChatOps'],
  ['compare', 'Compare Versions'],
  ['consent', 'Consent'],
  ['create', 'New'],
  ['custom-fields', 'Custom Fields'],
  ['edit', 'Edit'],
  ['emergency', 'Emergency'],
  ['events', 'Event Logs'],
  ['executions', 'Executions'],
  ['executive', 'Executive Reports'],
  ['health', 'Health'],
  ['help', 'Help'],
  ['history', 'History'],
  ['incident-sla', 'Incident SLA'],
  ['incidents', 'Incidents'],
  ['integrations', 'Integrations'],
  ['jira', 'Jira'],
  ['link', 'Link Account'],
  ['mcp', 'MCP'],
  ['microsoft-teams', 'Microsoft Teams'],
  ['new', 'New'],
  ['notifications', 'Notifications'],
  ['operations', 'Operations'],
  ['performance', 'Performance'],
  ['policies', 'Escalation Policies'],
  ['pools', 'Pools'],
  ['postmortems', 'Postmortems'],
  ['privacy-requests', 'Privacy Requests'],
  ['profile', 'Profile'],
  ['reports', 'Reports & Dashboards'],
  ['requests', 'Requests'],
  ['runbooks', 'Runbooks'],
  ['schedules', 'Schedules'],
  ['secrets', 'Secrets'],
  ['security', 'Security'],
  ['security-compliance', 'Security & Compliance'],
  ['service-objectives', 'Service Objectives'],
  ['services', 'Services'],
  ['settings', 'Settings'],
  ['setup', 'Setup'],
  ['shortcuts', 'Keyboard Shortcuts'],
  ['slack', 'Slack'],
  ['status-page', 'Status Page'],
  ['status-pages', 'Status Pages'],
  ['system', 'System'],
  ['system-logs', 'System Logs'],
  ['teams', 'Teams'],
  ['templates', 'Templates'],
  ['test', 'Test Event'],
  ['users', 'Users'],
  ['webhooks', 'Webhooks'],
]);

/** Singular noun for an entity id, keyed by the segment that precedes it. */
const ENTITY_NOUNS = new Map<string, string>([
  ['agents', 'Agent'],
  ['approvals', 'Approval'],
  ['assistants', 'Assistant'],
  ['automations', 'Automation'],
  ['executions', 'Execution'],
  ['executive', 'Report'],
  ['incidents', 'Incident'],
  ['operations', 'Operation'],
  ['policies', 'Policy'],
  ['postmortems', 'Postmortem'],
  ['runbooks', 'Runbook'],
  ['schedules', 'Schedule'],
  ['services', 'Service'],
  ['status-pages', 'Status Page'],
  ['teams', 'Team'],
  ['users', 'User'],
  ['webhooks', 'Webhook'],
]);

export type Crumb = {
  /** Path up to and including this segment. */
  href: string;
  label: string;
  /** Whether a page exists at `href` (and it is not the current page). */
  isLink: boolean;
  isCurrent: boolean;
  /** The segment is a record id; `label` is the entity name or a short-id fallback. */
  isEntity: boolean;
  /** Full raw segment, for tooltips on entity crumbs. */
  segment: string;
};

const PATTERN_SEGMENTS = APP_ROUTE_PATTERNS.map(pattern => pattern.split('/').filter(Boolean));

function isDynamic(segment: string) {
  return segment.startsWith('[') && segment.endsWith(']');
}

/** The route pattern a concrete path resolves to, preferring static segments. */
export function matchRoutePattern(segments: readonly string[]): readonly string[] | null {
  let best: readonly string[] | null = null;
  let bestStatic = -1;
  for (const pattern of PATTERN_SEGMENTS) {
    if (pattern.length !== segments.length) continue;
    let staticCount = 0;
    const matches = pattern.every((part, index) => {
      if (isDynamic(part)) return true;
      staticCount += 1;
      return part === segments.at(index);
    });
    if (matches && staticCount > bestStatic) {
      best = pattern;
      bestStatic = staticCount;
    }
  }
  return best;
}

const ID_LIKE =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|c[a-z0-9]{16,}|[A-Za-z0-9_-]{20,})$/i;

function humanize(segment: string): string {
  return decodeSegment(segment)
    .split('-')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export type EntityLabels = ReadonlyMap<string, string>;

const NO_LABELS: EntityLabels = new Map();

/** Breadcrumbs for `pathname` (excluding Home). Empty on the home page. */
export function buildBreadcrumbs(
  pathname: string,
  entityLabels: EntityLabels = NO_LABELS
): Crumb[] {
  const path = pathname.split(/[?#]/, 1)[0] ?? '/';
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return [];

  // Find which positions are dynamic from the deepest prefix that is a known route.
  const dynamicAt = new Set<number>();
  for (let length = segments.length; length > 0; length -= 1) {
    const pattern = matchRoutePattern(segments.slice(0, length));
    if (!pattern) continue;
    pattern.forEach((part, index) => {
      if (isDynamic(part)) dynamicAt.add(index);
    });
    break;
  }

  return segments.map((segment, index) => {
    const href = `/${segments.slice(0, index + 1).join('/')}`;
    const isCurrent = index === segments.length - 1;
    const known = SEGMENT_LABELS.get(segment);
    const isEntity = dynamicAt.has(index) || (!known && ID_LIKE.test(segment));
    const previous = index > 0 ? segments[index - 1] : undefined;
    const noun = previous ? ENTITY_NOUNS.get(previous) : undefined;
    const registered = entityLabels.get(href);

    let label: string;
    if (isEntity) {
      label = registered || (noun ? `${noun} ${shortId(segment)}` : shortId(segment));
    } else {
      label = known ?? humanize(segment);
    }

    return {
      href,
      label,
      isLink: !isCurrent && matchRoutePattern(segments.slice(0, index + 1)) !== null,
      isCurrent,
      isEntity,
      segment: decodeSegment(segment),
    };
  });
}

/** Href of the deepest entity crumb when it is the current page (the page's own record). */
export function currentEntityHref(pathname: string): string | null {
  const crumbs = buildBreadcrumbs(pathname);
  const last = crumbs.at(-1);
  return last?.isEntity ? last.href : null;
}
