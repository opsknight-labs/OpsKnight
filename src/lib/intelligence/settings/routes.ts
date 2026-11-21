/**
 * Information architecture of Settings → Intelligence.
 *
 * Five groups, each one page with anchored sections. This module is the single source of truth for
 * the sub-navigation, the in-page section links, the redirects that keep every earlier route
 * working, and the links other parts of the application use to reach a setting. It has no
 * dependencies so client components, server actions and tests can all import it.
 */

export const INTELLIGENCE_SETTINGS_ROOT = '/settings/intelligence';

export type IntelligenceSettingsGroupId =
  'engine' | 'noise' | 'services' | 'assistant' | 'evaluation';

export interface IntelligenceSettingsSection {
  /** DOM id of the section; the URL fragment that deep-links to it. */
  id: string;
  label: string;
}

export interface IntelligenceSettingsGroup {
  id: IntelligenceSettingsGroupId;
  label: string;
  href: string;
  summary: string;
  sections: readonly IntelligenceSettingsSection[];
}

export const INTELLIGENCE_SETTINGS_GROUPS = [
  {
    id: 'engine',
    label: 'Engine',
    href: INTELLIGENCE_SETTINGS_ROOT,
    summary:
      'Setup, master switch, operations insights, global policy, triage, correlation rules and lane health.',
    sections: [
      { id: 'setup', label: 'Setup' },
      { id: 'lane-health', label: 'Lane health' },
      { id: 'general', label: 'General' },
      { id: 'operations-insights', label: 'Operations insights' },
      { id: 'digest', label: 'Weekly digest' },
      { id: 'global-policy', label: 'Global policy' },
      { id: 'triage', label: 'Triage' },
      { id: 'correlation-rules', label: 'Correlation rules' },
      { id: 'failed-work', label: 'Failed work' },
    ],
  },
  {
    id: 'noise',
    label: 'Noise controls',
    href: `${INTELLIGENCE_SETTINGS_ROOT}/noise-controls`,
    summary: 'What happens to an alert before anyone is paged.',
    sections: [
      { id: 'policy', label: 'Policy' },
      { id: 'suppression-rules', label: 'Suppression rules' },
      { id: 'maintenance-windows', label: 'Noise maintenance rules' },
      { id: 'policy-history', label: 'Orchestration versions' },
      { id: 'heartbeats', label: 'Heartbeats' },
      { id: 'simulation', label: 'Simulation' },
      { id: 'decisions', label: 'Recent decisions' },
    ],
  },
  {
    id: 'services',
    label: 'Services & changes',
    href: `${INTELLIGENCE_SETTINGS_ROOT}/services`,
    summary: 'Per-service policies, dependencies, change sources and alert quality.',
    sections: [
      { id: 'service-policies', label: 'Per-service policies' },
      { id: 'dependencies', label: 'Dependencies' },
      { id: 'topology-sources', label: 'Topology sources' },
      { id: 'metric-evidence', label: 'Metric anomaly evidence' },
      { id: 'change-sources', label: 'Change sources' },
      { id: 'alert-quality', label: 'Alert quality' },
    ],
  },
  {
    id: 'assistant',
    label: 'Assistant',
    href: `${INTELLIGENCE_SETTINGS_ROOT}/ai`,
    summary: 'Squire, the language models behind it and what it may read.',
    sections: [
      { id: 'assistant', label: 'General' },
      { id: 'providers', label: 'Providers' },
      { id: 'model-routing', label: 'Model routing' },
      { id: 'prompts', label: 'Prompts' },
      { id: 'checks', label: 'Checks library' },
      { id: 'connections', label: 'Connections' },
      { id: 'knowledge-memory', label: 'Knowledge memory' },
      { id: 'proactive', label: 'Proactive help' },
    ],
  },
  {
    id: 'evaluation',
    label: 'Evaluation & spend',
    href: `${INTELLIGENCE_SETTINGS_ROOT}/evaluation`,
    summary: 'How good the suggestions and answers are, and what AI costs.',
    sections: [
      { id: 'grouping-quality', label: 'Grouping evaluation' },
      { id: 'answer-feedback', label: 'Answer evaluation' },
      { id: 'insights', label: 'Insights' },
      { id: 'learned-weights', label: 'Learned weights' },
      { id: 'usage', label: 'Usage' },
      { id: 'ai-spend', label: 'Spend and budgets' },
    ],
  },
] as const satisfies readonly IntelligenceSettingsGroup[];

const group = (id: IntelligenceSettingsGroupId): IntelligenceSettingsGroup => {
  const found = INTELLIGENCE_SETTINGS_GROUPS.find(candidate => candidate.id === id);
  if (!found) throw new Error(`Unknown intelligence settings group: ${id}`);
  return found;
};

/** Path of a group page, e.g. `intelligenceSettingsPath('noise')`. Use with `revalidatePath`. */
export function intelligenceSettingsPath(id: IntelligenceSettingsGroupId): string {
  return group(id).href;
}

/** Link to a group page, optionally to one of its sections. Throws on an unknown section. */
export function intelligenceSettingsHref(
  id: IntelligenceSettingsGroupId,
  section?: string
): string {
  const target = group(id);
  if (!section) return target.href;
  if (!target.sections.some(candidate => candidate.id === section)) {
    throw new Error(`Unknown section "${section}" in intelligence settings group ${id}`);
  }
  return `${target.href}#${section}`;
}

export interface LegacyIntelligenceRoute {
  /** The route as it existed before the regrouping. */
  from: string;
  group: IntelligenceSettingsGroupId;
  section: string;
}

/**
 * Routes that used to be pages of their own. Each still resolves: its `page.tsx` redirects to the
 * section that now holds the same controls, keeping the query string.
 */
export const LEGACY_INTELLIGENCE_ROUTES = [
  { from: `${INTELLIGENCE_SETTINGS_ROOT}/response`, group: 'services', section: 'dependencies' },
  { from: `${INTELLIGENCE_SETTINGS_ROOT}/insights`, group: 'evaluation', section: 'insights' },
  {
    from: `${INTELLIGENCE_SETTINGS_ROOT}/quality`,
    group: 'evaluation',
    section: 'grouping-quality',
  },
  { from: `${INTELLIGENCE_SETTINGS_ROOT}/connections`, group: 'assistant', section: 'connections' },
  {
    from: `${INTELLIGENCE_SETTINGS_ROOT}/ai/memory`,
    group: 'assistant',
    section: 'knowledge-memory',
  },
] as const satisfies readonly LegacyIntelligenceRoute[];

/**
 * Sections that moved to another group. A fragment never reaches the server, so the old group page sends
 * a matching hash on (`MovedSectionRedirect`); new links use `intelligenceSettingsHref` directly.
 */
export const MOVED_INTELLIGENCE_SECTIONS = [
  { fromGroup: 'evaluation', section: 'digest', group: 'engine' },
] as const satisfies ReadonlyArray<{
  fromGroup: IntelligenceSettingsGroupId;
  section: string;
  group: IntelligenceSettingsGroupId;
}>;

/** Where `#section` on a group page now lives, or null when it has not moved. */
export function movedIntelligenceSection(
  fromGroup: IntelligenceSettingsGroupId,
  section: string
): string | null {
  const moved = MOVED_INTELLIGENCE_SECTIONS.find(
    candidate => candidate.fromGroup === fromGroup && candidate.section === section
  );
  return moved ? intelligenceSettingsHref(moved.group, moved.section) : null;
}

export type LegacyIntelligenceRoutePath = (typeof LEGACY_INTELLIGENCE_ROUTES)[number]['from'];

export type RouteSearchParams = Record<string, string | string[] | undefined>;

/** Query string (with the leading `?`, or empty) carrying every parameter over unchanged. */
export function serializeSearchParams(params: RouteSearchParams | undefined): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

/** Where an earlier route now lives, with its query string and the section's fragment. */
export function legacyIntelligenceRedirect(
  from: LegacyIntelligenceRoutePath,
  params?: RouteSearchParams
): string {
  const route = LEGACY_INTELLIGENCE_ROUTES.find(candidate => candidate.from === from);
  if (!route) throw new Error(`No redirect is defined for ${from}`);
  return `${group(route.group).href}${serializeSearchParams(params)}#${route.section}`;
}
