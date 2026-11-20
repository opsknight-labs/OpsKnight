/**
 * Pure model for the ⌘K command palette: static commands, ranking, entity grouping
 * and recent-item persistence. No React, so it is cheap to test and to import.
 */

export type EntityType =
  'incident' | 'service' | 'team' | 'user' | 'schedule' | 'runbook' | 'policy' | 'postmortem';

export type SearchResult = {
  type: EntityType;
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  avatarUrl?: string | null;
};

/** Entity groups in display order, with the heading the palette shows. */
export const ENTITY_GROUPS: ReadonlyArray<{ type: EntityType; label: string }> = [
  { type: 'incident', label: 'Incidents' },
  { type: 'service', label: 'Services' },
  { type: 'user', label: 'People' },
  { type: 'team', label: 'Teams' },
  { type: 'schedule', label: 'Schedules' },
  { type: 'runbook', label: 'Runbooks' },
  { type: 'policy', label: 'Escalation policies' },
  { type: 'postmortem', label: 'Postmortems' },
];

const ENTITY_TYPES = new Set<string>(ENTITY_GROUPS.map(group => group.type));

export function isSearchResult(value: unknown): value is SearchResult {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === 'string' &&
    ENTITY_TYPES.has(candidate.type) &&
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.href === 'string' &&
    candidate.href.startsWith('/')
  );
}

export function groupResults(
  results: SearchResult[]
): Array<{ type: EntityType; label: string; items: SearchResult[] }> {
  return ENTITY_GROUPS.map(group => ({
    ...group,
    items: results.filter(result => result.type === group.type),
  })).filter(group => group.items.length > 0);
}

export type CommandGroupId = 'actions' | 'navigate';

export type PaletteCommand = {
  id: string;
  group: CommandGroupId;
  title: string;
  subtitle?: string;
  keywords: string[];
  /** Navigation target. Commands without one run an in-app action keyed by `id`. */
  href?: string;
  /** Key caps shown on the right, e.g. ['G', 'D']. */
  shortcut?: string[];
};

/** Lower is better: exact title, title prefix, word prefix, then substring matches. */
export function scoreCommand(command: PaletteCommand, rawQuery: string): number {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return 1;
  const title = command.title.toLowerCase();
  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (title.split(/[\s/&-]+/).some(word => word.startsWith(query))) return 60;
  if (title.includes(query)) return 40;
  if (command.keywords.some(keyword => keyword.startsWith(query))) return 30;
  if (command.keywords.some(keyword => keyword.includes(query))) return 20;
  if (command.subtitle?.toLowerCase().includes(query)) return 10;
  return 0;
}

/** Commands matching the query, best first; ties keep declaration order. */
export function rankCommands<T extends PaletteCommand>(commands: T[], query: string): T[] {
  return commands
    .map((command, index) => ({ command, index, score: scoreCommand(command, query) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(entry => entry.command);
}

// Recent items --------------------------------------------------------------

export const RECENTS_KEY = 'opsknight-palette-recents-v1';
export const MAX_RECENTS = 8;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

function storage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readRecents(store: StorageLike | null = storage()): SearchResult[] {
  try {
    const parsed: unknown = JSON.parse(store?.getItem(RECENTS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isSearchResult).slice(0, MAX_RECENTS) : [];
  } catch {
    return [];
  }
}

/** Moves `item` to the front, de-duplicated by type and id, capped at MAX_RECENTS. */
export function pushRecent(
  item: SearchResult,
  store: StorageLike | null = storage()
): SearchResult[] {
  const entry: SearchResult = {
    type: item.type,
    id: item.id,
    title: item.title,
    subtitle: item.subtitle,
    href: item.href,
    avatarUrl: item.avatarUrl,
  };
  const next = [
    entry,
    ...readRecents(store).filter(recent => !(recent.type === item.type && recent.id === item.id)),
  ].slice(0, MAX_RECENTS);
  try {
    store?.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Private mode or full quota: recents are a convenience, never block navigation.
  }
  return next;
}
