'use client';

import { useEffect, useRef, useState, useMemo, useCallback, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';
import { Command as CommandPrimitive } from 'cmdk';
import {
  Command,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/shadcn/command';
import { Popover, PopoverContent, PopoverAnchor } from '@/components/ui/shadcn/popover';
import {
  Zap,
  Wrench,
  Users,
  Calendar,
  Shield,
  FileText,
  Search as SearchIcon,
  History,
  Loader2,
  CornerDownLeft,
  X,
  Server,
  Sun,
  Moon,
  Monitor,
  Check,
  HelpCircle,
  Keyboard,
  type LucideIcon,
} from 'lucide-react';
import { useAccess } from '@/components/access/AccessProvider';
import { getAuthorizedNavItems } from '@/config/navigation';
import { canAccessPath } from '@/lib/access/pages';
import { getRoleCapabilities, isAppRole, type Capability } from '@/lib/authorization';
import { GLOBAL_NAVIGATION_SHORTCUTS } from '@/lib/keyboard-shortcuts';
import { useThemePreference } from '@/hooks/use-theme-preference';
import type { ThemeChoice } from '@/lib/theme-preference';
import { Badge } from '@/components/ui/shadcn/badge';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';

type SearchResult = {
  type: 'incident' | 'service' | 'team' | 'user' | 'policy' | 'postmortem';
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  priority?: number;
  metadata?: Record<string, unknown>;
  avatarUrl?: string | null;
  gender?: string | null;
};

type RecentSearch = {
  query: string;
  timestamp: number;
  resultCount?: number;
};

type NavigationPage = {
  id: string;
  title: string;
  subtitle: string;
  href: string;
  icon: LucideIcon;
  keywords: string[];
  shortcut?: string;
};

const RECENT_SEARCHES_KEY = 'OpsKnight-recent-searches-v2';
const MAX_RECENT_SEARCHES = 5;
const TYPE_ORDER = ['incident', 'service', 'team', 'user', 'policy', 'postmortem'] as const;

/** Subtitles and search keywords for "Go to" commands, keyed by nav href. */
const NAVIGATION_META = new Map<string, { subtitle: string; keywords: string[] }>([
  [
    '/',
    { subtitle: 'System overview & metrics', keywords: ['overview', 'home', 'main', 'summary'] },
  ],
  [
    '/incidents',
    {
      subtitle: 'Active & resolved incidents',
      keywords: ['incident', 'alerts', 'outages', 'issues', 'tickets'],
    },
  ],
  [
    '/services',
    {
      subtitle: 'Service registry & status',
      keywords: ['service', 'components', 'microservices', 'infrastructure', 'endpoints'],
    },
  ],
  [
    '/runbooks',
    {
      subtitle: 'Automated remediation & executions',
      keywords: ['runbook', 'automation', 'remediation', 'playbooks', 'agents', 'executions'],
    },
  ],
  [
    '/postmortems',
    {
      subtitle: 'Root cause analysis & lessons learned',
      keywords: ['postmortem', 'rca', 'retrospectives', 'lessons', 'incident reports'],
    },
  ],
  [
    '/action-items',
    {
      subtitle: 'Post-incident corrective actions',
      keywords: ['action item', 'tasks', 'remediation', 'todos', 'followups'],
    },
  ],
  [
    '/schedules',
    {
      subtitle: 'On-call shifts & rotations',
      keywords: ['schedule', 'oncall', 'on-call', 'shifts', 'rotations', 'calendar', 'handoff'],
    },
  ],
  [
    '/policies',
    {
      subtitle: 'Alert routing & escalation tiers',
      keywords: ['policy', 'escalation', 'routing', 'rules', 'tiers'],
    },
  ],
  ['/teams', { subtitle: 'Team directory & rosters', keywords: ['team', 'groups', 'squads'] }],
  [
    '/users',
    {
      subtitle: 'User directory & access roles',
      keywords: ['user', 'people', 'responders', 'accounts', 'members', 'directory'],
    },
  ],
  [
    '/analytics',
    {
      subtitle: 'MTTA, MTTR & SLA compliance trends',
      keywords: ['metrics', 'mtta', 'mttr', 'sla', 'trends', 'insights', 'uptime'],
    },
  ],
  [
    '/reports',
    {
      subtitle: 'Executive reports & reliability widgets',
      keywords: ['report', 'dashboards', 'executive', 'reliability'],
    },
  ],
  [
    '/audit',
    { subtitle: 'Who changed what, and when', keywords: ['audit', 'history', 'compliance'] },
  ],
  [
    '/events',
    {
      subtitle: 'Inbound alert events & payloads',
      keywords: ['events', 'logs', 'alerts', 'payloads'],
    },
  ],
  [
    '/settings',
    {
      subtitle: 'Integrations, API keys & preferences',
      keywords: ['setting', 'configuration', 'integrations', 'api keys', 'slack', 'profile'],
    },
  ],
  [
    '/help',
    { subtitle: 'Guides & support', keywords: ['help', 'support', 'docs', 'documentation'] },
  ],
  [
    '/shortcuts',
    { subtitle: 'Every keyboard shortcut', keywords: ['keyboard', 'shortcuts', 'hotkeys', 'keys'] },
  ],
]);

/** Pages outside the sidebar's main sections that the palette can still open. */
const EXTRA_NAVIGATION: ReadonlyArray<{ href: string; label: string; icon: LucideIcon }> = [
  { href: '/settings', label: 'Settings', icon: Wrench },
  { href: '/help', label: 'Help', icon: HelpCircle },
  { href: '/shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
];

const NAV_SHORTCUT_KEYS = new Map<string, string>(
  GLOBAL_NAVIGATION_SHORTCUTS.map(item => [item.href, `G ${item.key.toUpperCase()}`])
);

function buildNavigationPages(access: readonly Capability[] | string | null): NavigationPage[] {
  const items = [...getAuthorizedNavItems(access), ...EXTRA_NAVIGATION];
  const capabilities =
    typeof access === 'string' ? (isAppRole(access) ? getRoleCapabilities(access) : []) : access;
  return items
    .filter(item => canAccessPath(item.href, capabilities ?? []))
    .map(item => {
      const meta = NAVIGATION_META.get(item.href);
      return {
        id: `nav-${item.href}`,
        title: item.label,
        subtitle: meta?.subtitle ?? '',
        href: item.href,
        icon: item.icon,
        keywords: meta?.keywords ?? [],
        shortcut: NAV_SHORTCUT_KEYS.get(item.href),
      };
    });
}

function matchesNavigation(page: NavigationPage, query: string): boolean {
  return (
    page.title.toLowerCase().includes(query) ||
    page.subtitle.toLowerCase().includes(query) ||
    page.keywords.some(keyword => keyword.includes(query))
  );
}

const QUICK_ACTIONS = [
  {
    id: 'qa-create',
    label: 'Create new incident',
    query: 'create incident',
    icon: Zap,
    category: 'Quick Create',
    description: 'Start new incident',
    href: '/incidents/create',
  },
];

const THEME_ACTIONS: Array<{ choice: ThemeChoice; label: string; icon: typeof Sun }> = [
  { choice: 'dark', label: 'Use dark theme', icon: Moon },
  { choice: 'light', label: 'Use light theme', icon: Sun },
  { choice: 'system', label: 'Match system theme', icon: Monitor },
];
const THEME_KEYWORDS = ['theme', 'appearance', 'dark', 'light', 'system', 'mode', 'color'];

const getTypeIcon = (type: string) => {
  switch (type) {
    case 'incident':
      return <Zap className="h-4 w-4 text-red-500" />;
    case 'service':
      return <Server className="h-4 w-4 text-blue-500" />;
    case 'team':
      return <Users className="h-4 w-4 text-orange-500" />;
    case 'user':
      return <Users className="h-4 w-4 text-purple-500" />;
    case 'schedule':
      return <Calendar className="h-4 w-4 text-emerald-500" />;
    case 'policy':
      return <Shield className="h-4 w-4 text-yellow-500" />;
    case 'postmortem':
      return <FileText className="h-4 w-4 text-ink-500" />;
    default:
      return <SearchIcon className="h-4 w-4" />;
  }
};

const getTypeLabel = (type: string) => {
  if (type === 'policy') return 'Escalation Policies';
  if (type === 'postmortem') return 'Postmortems';
  return type.charAt(0).toUpperCase() + type.slice(1) + 's';
};

const SearchFooter = () => (
  <div className="hidden border-t border-border dark:border-zinc-800/80 px-3 py-1.5 text-[10px] text-muted-foreground sm:flex items-center justify-between bg-muted/30 dark:bg-zinc-900/50">
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1">
        <kbd className="pointer-events-none inline-flex h-4 items-center gap-0.5 rounded border border-border dark:border-zinc-700 bg-muted dark:bg-zinc-800 px-1 font-mono font-medium opacity-100 text-[10px] text-foreground">
          <span>↑</span>
        </kbd>
        <kbd className="pointer-events-none inline-flex h-4 items-center gap-0.5 rounded border border-border dark:border-zinc-700 bg-muted dark:bg-zinc-800 px-1 font-mono font-medium opacity-100 text-[10px] text-foreground">
          <span>↓</span>
        </kbd>
        <span>navigate</span>
      </div>
      <div className="flex items-center gap-1">
        <kbd className="pointer-events-none inline-flex h-4 items-center gap-0.5 rounded border border-border dark:border-zinc-700 bg-muted dark:bg-zinc-800 px-1 font-mono font-medium opacity-100 text-[10px] text-foreground">
          <CornerDownLeft className="h-2 w-2" />
        </kbd>
        <span>select</span>
      </div>
    </div>
  </div>
);

const emptySubscribe = () => () => {};

let recentSearchesCache: RecentSearch[] | null = null;
const recentSearchesListeners = new Set<() => void>();

function subscribeRecentSearches(callback: () => void) {
  recentSearchesListeners.add(callback);
  return () => {
    recentSearchesListeners.delete(callback);
  };
}

function getRecentSearchesSnapshot(): RecentSearch[] {
  if (typeof window === 'undefined') return [];
  if (recentSearchesCache === null) {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] !== 'string') {
          recentSearchesCache = parsed;
        } else {
          recentSearchesCache = [];
        }
      } else {
        recentSearchesCache = [];
      }
    } catch {
      recentSearchesCache = [];
    }
  }
  return recentSearchesCache;
}

const SERVER_RECENT_SEARCHES: RecentSearch[] = [];
function getRecentSearchesServerSnapshot(): RecentSearch[] {
  return SERVER_RECENT_SEARCHES;
}

function saveRecentSearchToStorage(searchQuery: string, resultCount?: number) {
  if (searchQuery.length < 2) return;
  try {
    const prev = getRecentSearchesSnapshot();
    const newSearch: RecentSearch = {
      query: searchQuery,
      timestamp: Date.now(),
      resultCount,
    };
    const updated = [
      newSearch,
      ...prev.filter(s => s.query.toLowerCase() !== searchQuery.toLowerCase()),
    ].slice(0, MAX_RECENT_SEARCHES);
    recentSearchesCache = updated;
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
    recentSearchesListeners.forEach(listener => listener());
  } catch {}
}

type SidebarSearchProps = {
  /** Built-in role, used for "Go to" commands until the access snapshot is available. */
  role?: string | null;
};

export default function SidebarSearch({ role = null }: SidebarSearchProps = {}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const activeQueryRef = useRef(query);
  const recentSearches = useSyncExternalStore(
    subscribeRecentSearches,
    getRecentSearchesSnapshot,
    getRecentSearchesServerSnapshot
  );

  const shortcutKey = useSyncExternalStore(
    emptySubscribe,
    () =>
      typeof navigator !== 'undefined' &&
      /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent)
        ? '⌘'
        : 'Ctrl',
    () => '⌘'
  );

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Where focus was before ⌘K, so Escape can hand it back.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const { snapshot: access } = useAccess();
  const navigationPages = useMemo(
    () => buildNavigationPages(access?.capabilities ?? access?.role ?? role),
    [access?.capabilities, access?.role, role]
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  const router = useRouter();
  const { openCreateIncident } = useCreateIncidentModal();

  const saveRecentSearch = useCallback((searchQuery: string, resultCount?: number) => {
    saveRecentSearchToStorage(searchQuery, resultCount);
  }, []);

  useEffect(() => {
    activeQueryRef.current = query;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const trimmed = query.trim();
    if (trimmed.length < 2) {
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const timeoutId = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: abortController.signal,
        });
        if (!response.ok) throw new Error('Search failed');
        const data = await response.json();
        // Only apply results if this request wasn't aborted and matches active query
        if (!abortController.signal.aborted && activeQueryRef.current.trim() === trimmed) {
          setResults(Array.isArray(data.results) ? data.results : []);
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') return;
        if (!abortController.signal.aborted && activeQueryRef.current.trim() === trimmed) {
          setResults([]);
        }
      } finally {
        if (!abortController.signal.aborted && activeQueryRef.current.trim() === trimmed) {
          setIsLoading(false);
        }
      }
    }, 300);

    return () => {
      clearTimeout(timeoutId);
      abortController.abort();
    };
  }, [query]);

  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // cmdk hard-codes aria-expanded="true" on its input; mirror the popover's real state.
  useEffect(() => {
    inputRef.current?.setAttribute('aria-expanded', String(open));
  }, [open]);

  // Keyboard shortcut handler. Window capture runs before Radix's dismiss handler, whose
  // re-render would otherwise detach a bubbling listener before Escape reaches it.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const active = document.activeElement;
        if (
          active instanceof HTMLElement &&
          active !== inputRef.current &&
          active !== document.body
        ) {
          returnFocusRef.current = active;
        }
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape' && openRef.current) {
        setOpen(false);
        const returnTo = returnFocusRef.current;
        returnFocusRef.current = null;
        if (returnTo?.isConnected) returnTo.focus();
        else inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, []);

  const handleSelect = useCallback(
    (_value: string, item?: { href?: string; id?: string; query?: string }) => {
      if (item?.href) {
        if (item.href === '/incidents/create' || item.id === 'qa-create') {
          openCreateIncident();
        } else {
          router.push(item.href);
        }
        if (query.length >= 2) {
          saveRecentSearch(query, results.length);
        }
        setOpen(false);
        setQuery('');
        returnFocusRef.current = null;
        inputRef.current?.blur();
      } else if (item?.query) {
        setQuery(item.query);
        setResults([]);
        setIsLoading(item.query.trim().length >= 2);
      }
    },
    [router, openCreateIncident, query, results.length, saveRecentSearch]
  );

  const themePreference = useThemePreference();
  const normalizedQuery = query.trim().toLowerCase();
  const showThemeActions =
    !themePreference.locked &&
    normalizedQuery.length > 0 &&
    THEME_KEYWORDS.some(word => word.startsWith(normalizedQuery) || normalizedQuery.includes(word));
  const selectTheme = useCallback(
    (choice: ThemeChoice) => {
      themePreference.setChoice(choice);
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    },
    [themePreference]
  );

  const matchingNavigation = useMemo(() => {
    if (!normalizedQuery) return navigationPages;
    return navigationPages.filter(page => matchesNavigation(page, normalizedQuery));
  }, [navigationPages, normalizedQuery]);

  const groupedResults = useMemo(() => {
    const groups = new Map<string, SearchResult[]>();
    TYPE_ORDER.forEach(type => groups.set(type, []));
    results.forEach(result => {
      const existing = groups.get(result.type);
      if (existing) {
        existing.push(result);
      } else {
        groups.set(result.type, [result]);
      }
    });
    return groups;
  }, [results]);

  const totalRenderedResultsCount = useMemo(() => {
    let count = 0;
    TYPE_ORDER.forEach(type => {
      count += groupedResults.get(type)?.length ?? 0;
    });
    return count;
  }, [groupedResults]);

  const hasAnyResults =
    matchingNavigation.length > 0 || (!isLoading && totalRenderedResultsCount > 0);

  const renderNavigationItem = (page: NavigationPage) => {
    const Icon = page.icon;
    return (
      <CommandItem
        key={page.id}
        value={page.id}
        onSelect={() => handleSelect(page.title, { href: page.href })}
        className="aria-selected:bg-accent aria-selected:text-accent-foreground cursor-pointer"
      >
        <div className="flex items-center justify-center h-7 w-7 rounded-sm bg-muted/70 mr-3 shrink-0">
          <Icon className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
        </div>
        <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
          <span className="font-medium text-sm">{page.title}</span>
          {page.subtitle && (
            <span className="text-2xs text-muted-foreground truncate">{page.subtitle}</span>
          )}
        </div>
        {page.shortcut && (
          <kbd
            className="ml-2 hidden shrink-0 rounded border border-border bg-muted px-1.5 font-mono text-2xs text-muted-foreground sm:inline-block"
            aria-label={`Shortcut ${page.shortcut}`}
          >
            {page.shortcut}
          </kbd>
        )}
      </CommandItem>
    );
  };

  return (
    <Command
      shouldFilter={false}
      label="Search or go to a page"
      className="overflow-visible bg-transparent border-0 shadow-none"
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <div
            ref={containerRef}
            className="relative w-full max-w-[420px]"
            onClick={() => {
              if (!open) setOpen(true);
              inputRef.current?.focus();
            }}
          >
            {/* 
              Redesign: Flex container mimicking the input style. 
              The actual input is transparent and sits next to the icon.
            */}
            <div className="flex h-9 w-full items-center rounded-lg border border-zinc-800/90 bg-[#18181b]/90 px-3 focus-within:ring-2 focus-within:ring-ring/60 focus-within:border-zinc-700 transition-all shadow-xs cursor-text">
              <SearchIcon className="mr-2 h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <CommandPrimitive.Input
                ref={inputRef}
                placeholder="Search or go to…"
                value={query}
                onValueChange={val => {
                  setQuery(val);
                  setResults([]);
                  if (val.trim().length >= 2) {
                    setIsLoading(true);
                  } else {
                    setIsLoading(false);
                  }
                  if (!open) setOpen(true);
                }}
                onFocus={() => {
                  setOpen(true);
                }}
                className="search-input topbar-search-input flex h-full w-full bg-transparent text-sm text-zinc-100 outline-none border-none placeholder:text-zinc-500 disabled:cursor-not-allowed disabled:opacity-50"
                style={{
                  backgroundColor: 'transparent',
                  color: '#f4f4f5',
                  border: 'none',
                  outline: 'none',
                  boxShadow: 'none',
                }}
              />
              {query.length > 0 && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    setQuery('');
                    setResults([]);
                    setIsLoading(false);
                    setOpen(false);
                    inputRef.current?.blur();
                  }}
                  className="mr-1 p-0.5 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                  aria-label="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
              {isLoading ? (
                <Loader2 className="ml-2 h-3 w-3 animate-spin text-zinc-400" />
              ) : (
                <div className="ml-2 hidden sm:flex items-center gap-1 opacity-80">
                  <kbd className="pointer-events-none h-5 select-none items-center gap-0.5 rounded bg-zinc-800/80 border border-zinc-700/70 px-1.5 font-mono text-[10px] font-medium text-zinc-400 shadow-2xs flex">
                    <span className="text-xs">{shortcutKey}</span>K
                  </kbd>
                </div>
              )}
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[340px] overflow-hidden bg-popover dark:bg-[#121216] border border-border dark:border-zinc-800 shadow-2xl rounded-xl"
          align="center"
          sideOffset={8}
          onOpenAutoFocus={(e: Event) => e.preventDefault()} // Don't steal focus from input
          // Focus is handed back by the Escape/select handlers, not to the input it opened from.
          onCloseAutoFocus={(e: Event) => e.preventDefault()}
          onInteractOutside={e => {
            if (containerRef.current && containerRef.current.contains(e.target as Node)) {
              e.preventDefault();
              return;
            }
            setOpen(false);
            inputRef.current?.blur();
          }}
        >
          <CommandList className="max-h-[500px] py-1">
            {isLoading && (
              <div className="flex items-center justify-center py-6 gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                <span>Searching...</span>
              </div>
            )}

            {!isLoading && normalizedQuery.length > 0 && !hasAnyResults && !showThemeActions && (
              <CommandEmpty>
                <div
                  role="status"
                  className="flex flex-col items-center justify-center gap-1 px-4 py-8 text-center"
                >
                  <SearchIcon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                  <p className="text-sm font-medium text-foreground">
                    No results for “{query.trim()}”
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {normalizedQuery.length < 2
                      ? 'Type at least 2 characters to search incidents, services and people.'
                      : 'Try a different name, ID or page.'}
                  </p>
                </div>
              </CommandEmpty>
            )}

            {query.length === 0 && (
              <>
                {recentSearches.length > 0 && (
                  <CommandGroup heading="Recent">
                    {recentSearches.map(recent => (
                      <CommandItem
                        key={`${recent.query}-${recent.timestamp}`}
                        value={`recent-${recent.query}`}
                        onSelect={() => handleSelect('', { query: recent.query })}
                        className="aria-selected:bg-accent aria-selected:text-accent-foreground cursor-pointer"
                      >
                        <History className="mr-3 h-4 w-4 opacity-70" />
                        <div className="flex flex-col">
                          <span className="font-medium">{recent.query}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                <CommandGroup heading="Quick Actions">
                  {QUICK_ACTIONS.map(action => (
                    <CommandItem
                      key={action.id}
                      value={action.label}
                      onSelect={() => handleSelect(action.label, action)}
                      className="aria-selected:bg-accent aria-selected:text-accent-foreground cursor-pointer"
                    >
                      <div className="flex items-center justify-center h-7 w-7 rounded-sm bg-muted mr-3">
                        <action.icon className="h-3.5 w-3.5 opacity-70" />
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium">{action.label}</span>
                        <span className="text-[10px] text-muted-foreground">
                          {action.description}
                        </span>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
                {navigationPages.length > 0 && (
                  <CommandGroup heading="Go to">
                    {navigationPages.map(renderNavigationItem)}
                  </CommandGroup>
                )}
              </>
            )}

            {showThemeActions && (
              <CommandGroup heading="Appearance">
                {[...THEME_ACTIONS]
                  .sort(
                    (a, b) =>
                      Number(b.choice.startsWith(normalizedQuery)) -
                      Number(a.choice.startsWith(normalizedQuery))
                  )
                  .map(action => {
                    const active = themePreference.choice === action.choice;
                    return (
                      <CommandItem
                        key={action.choice}
                        value={`${action.label} theme appearance`}
                        onSelect={() => selectTheme(action.choice)}
                        className="aria-selected:bg-accent aria-selected:text-accent-foreground cursor-pointer"
                      >
                        <div className="flex items-center justify-center h-7 w-7 rounded-sm bg-muted mr-3">
                          <action.icon className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
                        </div>
                        <span className="font-medium flex-1">{action.label}</span>
                        {active && (
                          <Check
                            className="h-3.5 w-3.5 text-muted-foreground"
                            aria-label="Current"
                          />
                        )}
                      </CommandItem>
                    );
                  })}
              </CommandGroup>
            )}

            {query.length > 0 && (
              <>
                {matchingNavigation.length > 0 && (
                  <CommandGroup heading="Go to">
                    {matchingNavigation.map(renderNavigationItem)}
                  </CommandGroup>
                )}

                {!isLoading &&
                  TYPE_ORDER.map(type => {
                    const items = groupedResults.get(type);
                    if (!items?.length) return null;
                    return (
                      <CommandGroup key={type} heading={getTypeLabel(type)}>
                        {items.map(result => (
                          <CommandItem
                            key={result.id}
                            value={`${result.type}-${result.id}-${result.title}`}
                            onSelect={() => handleSelect('', result)}
                            className="aria-selected:bg-accent aria-selected:text-accent-foreground group cursor-pointer"
                          >
                            {result.type === 'user' ? (
                              <div className="mr-3 shrink-0">
                                <DirectUserAvatar
                                  avatarUrl={
                                    result.avatarUrl || getDefaultAvatar(result.gender, result.id)
                                  }
                                  name={result.title}
                                  size="sm"
                                />
                              </div>
                            ) : (
                              <div className="mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-muted/50">
                                {getTypeIcon(result.type)}
                              </div>
                            )}
                            <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                              <div className="flex items-center gap-2">
                                <span className="font-medium truncate text-sm">{result.title}</span>
                                {result.priority && (
                                  <Badge variant="neutral" size="xs" className="uppercase">
                                    P{result.priority}
                                  </Badge>
                                )}
                              </div>
                              {result.subtitle && (
                                <span className="text-[10px] text-muted-foreground truncate">
                                  {result.subtitle}
                                </span>
                              )}
                            </div>
                            <div className="ml-auto">
                              {typeof result.metadata?.status === 'string' && (
                                <Badge
                                  variant={
                                    result.metadata.status === 'resolved' ? 'success' : 'danger'
                                  }
                                  size="xs"
                                  className="capitalize"
                                >
                                  {result.metadata.status}
                                </Badge>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    );
                  })}
              </>
            )}
          </CommandList>
          <SearchFooter />
        </PopoverContent>
      </Popover>
      {/* cmdk's input always points aria-controls at the list; keep an empty one mounted while closed. */}
      {!open && <CommandList hidden />}
    </Command>
  );
}
