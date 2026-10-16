export const FLEET_BASE_PATH = '/runbooks/agents';

export type FleetSection = 'agents' | 'pools' | 'secrets' | 'security';

export const FLEET_SECTIONS: ReadonlyArray<{ key: FleetSection; label: string; href: string }> = [
  { key: 'agents', label: 'Agents', href: FLEET_BASE_PATH },
  { key: 'pools', label: 'Pools', href: `${FLEET_BASE_PATH}/pools` },
  { key: 'secrets', label: 'Secrets', href: `${FLEET_BASE_PATH}/secrets` },
  { key: 'security', label: 'Security', href: `${FLEET_BASE_PATH}/security` },
];

type SearchParams = Record<string, string | string[] | undefined>;

// Legacy `?tab=` param names mapped onto the page-local names of each sub-route.
const LEGACY_TABS = new Map<string, { path: string; params: Array<[string, string]> }>([
  [
    'pools',
    {
      path: `${FLEET_BASE_PATH}/pools`,
      params: [
        ['page', 'page'],
        ['poolId', 'pool'],
        ['memberPage', 'memberPage'],
      ],
    },
  ],
  [
    'secrets',
    {
      path: `${FLEET_BASE_PATH}/secrets`,
      params: [
        ['page', 'page'],
        ['secretId', 'secret'],
        ['grantPage', 'grantPage'],
      ],
    },
  ],
  ['security', { path: `${FLEET_BASE_PATH}/security`, params: [] }],
]);

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function legacyFleetRedirect(params: SearchParams): string | null {
  const tab = first(params.tab);
  const target = tab ? LEGACY_TABS.get(tab) : undefined;
  if (!target) return null;
  const lookup = new Map(Object.entries(params));
  const next = new URLSearchParams();
  for (const [legacy, current] of target.params) {
    const value = first(lookup.get(legacy)) ?? first(lookup.get(current));
    if (value) next.set(current, value.slice(0, 200));
  }
  const search = next.toString();
  return search ? `${target.path}?${search}` : target.path;
}

export function fleetHref(path: string, params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

export function isFleetSectionActive(pathname: string, section: FleetSection) {
  const within = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  if (section !== 'agents') return within(`${FLEET_BASE_PATH}/${section}`);
  // Agent detail routes (/runbooks/agents/[id]) belong to the Agents section.
  return (
    within(FLEET_BASE_PATH) &&
    !FLEET_SECTIONS.some(item => item.key !== 'agents' && within(item.href))
  );
}
