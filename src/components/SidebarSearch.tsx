'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/shadcn/popover';
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
  LayoutDashboard,
  Server,
  PieChart,
  BarChart,
  ListTodo,
} from 'lucide-react';
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
  icon: typeof Zap;
  keywords: string[];
};

const RECENT_SEARCHES_KEY = 'OpsKnight-recent-searches-v2';
const MAX_RECENT_SEARCHES = 5;
const TYPE_ORDER = [
  'incident',
  'service',
  'team',
  'user',
  'policy',
  'postmortem',
] as const;

const NAVIGATION_PAGES: NavigationPage[] = [
  {
    id: 'nav-dashboard',
    title: 'Dashboard',
    subtitle: 'System overview & metrics',
    href: '/',
    icon: LayoutDashboard,
    keywords: ['dashboard', 'overview', 'home', 'main', 'summary'],
  },
  {
    id: 'nav-incidents',
    title: 'Incidents',
    subtitle: 'Active & resolved incidents',
    href: '/incidents',
    icon: Zap,
    keywords: ['incidents', 'incident', 'alerts', 'outages', 'issues', 'tickets'],
  },
  {
    id: 'nav-services',
    title: 'Services',
    subtitle: 'Service registry & status',
    href: '/services',
    icon: Server,
    keywords: ['services', 'service', 'components', 'microservices', 'infrastructure', 'endpoints'],
  },
  {
    id: 'nav-schedules',
    title: 'Schedules',
    subtitle: 'On-call shifts & rotations',
    href: '/schedules',
    icon: Calendar,
    keywords: ['schedules', 'schedule', 'oncall', 'shifts', 'rotations', 'calendar', 'handoff'],
  },
  {
    id: 'nav-policies',
    title: 'Escalation Policies',
    subtitle: 'Alert routing & escalation tiers',
    href: '/policies',
    icon: Shield,
    keywords: ['policies', 'policy', 'escalation', 'routing', 'rules', 'tiers'],
  },
  {
    id: 'nav-teams',
    title: 'Teams',
    subtitle: 'Team directory & rosters',
    href: '/teams',
    icon: Users,
    keywords: ['teams', 'team', 'groups', 'squads', 'members'],
  },
  {
    id: 'nav-users',
    title: 'Users',
    subtitle: 'User directory & access roles',
    href: '/users',
    icon: Users,
    keywords: ['users', 'user', 'people', 'responders', 'accounts', 'members', 'directory'],
  },
  {
    id: 'nav-analytics',
    title: 'Analytics',
    subtitle: 'MTTA, MTTR & SLA compliance trends',
    href: '/analytics',
    icon: PieChart,
    keywords: ['analytics', 'metrics', 'mtta', 'mttr', 'sla', 'trends', 'insights', 'uptime'],
  },
  {
    id: 'nav-reports',
    title: 'Reports & Dashboards',
    subtitle: 'Executive reports & reliability widgets',
    href: '/reports',
    icon: BarChart,
    keywords: ['reports', 'report', 'dashboards', 'dashboard', 'executive', 'reliability'],
  },
  {
    id: 'nav-postmortems',
    title: 'Postmortems',
    subtitle: 'Root cause analysis & lessons learned',
    href: '/postmortems',
    icon: FileText,
    keywords: ['postmortems', 'postmortem', 'rca', 'retrospectives', 'lessons', 'incident reports'],
  },
  {
    id: 'nav-action-items',
    title: 'Action Items',
    subtitle: 'Post-incident corrective actions',
    href: '/action-items',
    icon: ListTodo,
    keywords: ['action items', 'action item', 'tasks', 'remediation', 'todos', 'followups'],
  },
  {
    id: 'nav-settings',
    title: 'Settings',
    subtitle: 'Integrations, API keys & preferences',
    href: '/settings',
    icon: Wrench,
    keywords: ['settings', 'setting', 'configuration', 'integrations', 'api keys', 'slack', 'profile'],
  },
];

const QUICK_ACTIONS = [
  {
    id: 'qa-incidents',
    label: 'View all incidents',
    query: 'incident',
    icon: Zap,
    category: 'Navigation',
    description: 'Browse all incidents',
    href: '/incidents',
  },
  {
    id: 'qa-services',
    label: 'View all services',
    query: 'service',
    icon: Server,
    category: 'Navigation',
    description: 'Manage services',
    href: '/services',
  },
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
      return <Calendar className="h-4 w-4 text-green-500" />;
    case 'policy':
      return <Shield className="h-4 w-4 text-yellow-500" />;
    case 'postmortem':
      return <FileText className="h-4 w-4 text-gray-500" />;
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

export default function SidebarSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [recentSearches, setRecentSearches] = useState<RecentSearch[]>([]);
  const [shortcutKey, setShortcutKey] = useState('Ctrl');
  const inputRef = useRef<HTMLInputElement>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const router = useRouter();
  const { openCreateIncident } = useCreateIncidentModal();

  useEffect(() => {
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] !== 'string') {
          setRecentSearches(parsed);
        }
      }
    } catch (_e) {}
  }, []);

  useEffect(() => {
    if (typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform)) {
      setShortcutKey('⌘');
    }
  }, []);

  const saveRecentSearch = useCallback((searchQuery: string, resultCount?: number) => {
    if (searchQuery.length < 2) return;
    try {
      const newSearch: RecentSearch = {
        query: searchQuery,
        timestamp: Date.now(),
        resultCount,
      };
      setRecentSearches(prev => {
        const updated = [
          newSearch,
          ...prev.filter(s => s.query.toLowerCase() !== searchQuery.toLowerCase()),
        ].slice(0, MAX_RECENT_SEARCHES);
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
        return updated;
      });
    } catch (_e) {}
  }, []);

  useEffect(() => {
    if (abortControllerRef.current) abortControllerRef.current.abort();

    if (query.length < 2) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    const timeoutId = setTimeout(async () => {
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: abortController.signal,
        });
        if (!response.ok) throw new Error('Search failed');
        const data = await response.json();
        if (data.results) {
          setResults(data.results);
        }
      } catch (_err) {
        // ignore
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query]);

  // Keyboard shortcut handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

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
        inputRef.current?.blur();
      } else if (item?.query) {
        setQuery(item.query);
      }
    },
    [router, openCreateIncident, query, results.length, saveRecentSearch]
  );

  const matchingNavigation = useMemo(() => {
    if (query.trim().length < 2) return [];
    const q = query.trim().toLowerCase();
    return NAVIGATION_PAGES.filter(
      page =>
        page.title.toLowerCase().includes(q) ||
        page.subtitle.toLowerCase().includes(q) ||
        page.keywords.some(k => k.toLowerCase().includes(q))
    );
  }, [query]);

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

  const hasAnyResults = matchingNavigation.length > 0 || totalRenderedResultsCount > 0;

  return (
    <Command shouldFilter={false} className="overflow-visible bg-transparent border-0 shadow-none">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative w-full max-w-[420px]">
            {/* 
              Redesign: Flex container mimicking the input style. 
              The actual input is transparent and sits next to the icon.
            */}
            <div className="flex h-9 w-full items-center rounded-lg border border-zinc-800/90 bg-[#18181b]/90 px-3 focus-within:ring-1 focus-within:ring-zinc-600/70 focus-within:border-zinc-700 transition-all shadow-xs">
              <SearchIcon className="mr-2 h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <CommandPrimitive.Input
                ref={inputRef}
                placeholder="Search..."
                value={query}
                onValueChange={val => {
                  setQuery(val);
                  if (val.trim().length > 0 && !open) setOpen(true);
                  if (val.trim().length === 0 && open) setOpen(false);
                }}
                onFocus={() => {
                  if (query.length > 0 || recentSearches.length > 0 || QUICK_ACTIONS.length > 0) {
                    setOpen(true);
                  }
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
                    setOpen(false);
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
        </PopoverTrigger>
        <PopoverContent
          className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[340px] overflow-hidden bg-popover dark:bg-[#121216] border border-border dark:border-zinc-800 shadow-2xl rounded-xl"
          align="center"
          sideOffset={8}
          onOpenAutoFocus={(e: Event) => e.preventDefault()} // Don't steal focus from input
          onInteractOutside={() => {
            setOpen(false);
            inputRef.current?.blur();
          }}
        >
          <CommandList className="max-h-[500px] py-1">
            {query.length >= 2 && !hasAnyResults && !isLoading && (
              <CommandEmpty>
                <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                  <p className="text-sm">No results found for &quot;{query}&quot;</p>
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
              </>
            )}

            {query.length > 0 && (
              <>
                {matchingNavigation.length > 0 && (
                  <CommandGroup heading="Navigation">
                    {matchingNavigation.map(page => {
                      const Icon = page.icon;
                      return (
                        <CommandItem
                          key={page.id}
                          value={`nav-${page.title}`}
                          onSelect={() => handleSelect(page.title, { href: page.href })}
                          className="aria-selected:bg-accent aria-selected:text-accent-foreground cursor-pointer"
                        >
                          <div className="flex items-center justify-center h-7 w-7 rounded-sm bg-muted/70 mr-3 shrink-0">
                            <Icon className="h-3.5 w-3.5 opacity-70" />
                          </div>
                          <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
                            <span className="font-medium text-sm">{page.title}</span>
                            <span className="text-[10px] text-muted-foreground truncate">
                              {page.subtitle}
                            </span>
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                )}

                {TYPE_ORDER.map(type => {
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
    </Command>
  );
}
