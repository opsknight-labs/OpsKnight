'use client';

import { logger } from '@/lib/logger';
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useCreateIncidentModal } from '@/contexts/IncidentCreationModalContext';
import { useModalState } from '@/hooks/useModalState';
import { Command as CommandPrimitive } from 'cmdk';
import {
  Command,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
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
  ArrowRight,
  Loader2,
  CornerDownLeft,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';
import { cn } from '@/lib/utils';
import { DirectUserAvatar } from '@/components/UserAvatar';
import { getDefaultAvatar } from '@/lib/avatar';

type SearchResult = {
  type: 'incident' | 'service' | 'team' | 'user' | 'policy' | 'postmortem';
  id: string;
  title: string;
  subtitle?: string;
  href: string;
  priority?: number;
  metadata?: Record<string, any>;
  avatarUrl?: string | null;
  gender?: string | null;
};

type RecentSearch = {
  query: string;
  timestamp: number;
  resultCount?: number;
};

const RECENT_SEARCHES_KEY = 'OpsKnight-recent-searches-v2';
const MAX_RECENT_SEARCHES = 5;

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
    icon: Wrench,
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
      return <Wrench className="h-4 w-4 text-blue-500" />;
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
  return type.charAt(0).toUpperCase() + type.slice(1) + 's';
};

const SearchFooter = () => (
  <div className="hidden border-t px-3 py-1.5 text-[10px] text-muted-foreground sm:flex items-center justify-between bg-muted/30">
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1">
        <kbd className="pointer-events-none inline-flex h-4 items-center gap-0.5 rounded border bg-muted px-1 font-mono font-medium opacity-100">
          <span className="text-[10px]">↑</span>
        </kbd>
        <kbd className="pointer-events-none inline-flex h-4 items-center gap-0.5 rounded border bg-muted px-1 font-mono font-medium opacity-100">
          <span className="text-[10px]">↓</span>
        </kbd>
        <span>navigate</span>
      </div>
      <div className="flex items-center gap-1">
        <kbd className="pointer-events-none inline-flex h-4 items-center gap-0.5 rounded border bg-muted px-1 font-mono font-medium opacity-100">
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

  // Check if Popover is installed, otherwise fallback to basic div logic?
  // Assuming Popover is available as I'm using it.

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
    if (!open) setOpen(true);

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
      } catch (err) {
        // ignore
      } finally {
        if (!abortController.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query, open]);

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
    (value: string, item?: any) => {
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
        setQuery(''); // Optional: Keep query or clear? Clearing usually better for nav.
        inputRef.current?.blur();
      } else if (item?.query) {
        setQuery(item.query);
        // Ensure it triggers search
      }
    },
    [router, openCreateIncident, query, results.length, saveRecentSearch]
  );

  const groupedResults = useMemo(() => {
    if (!results.length) return {};
    const groups: Record<string, SearchResult[]> = {};
    results.forEach(result => {
      if (!groups[result.type]) groups[result.type] = [];
      groups[result.type].push(result);
    });
    return groups;
  }, [results]);

  const typeOrder = ['incident', 'service', 'team', 'user'];

  return (
    <Command shouldFilter={false} className="overflow-visible bg-transparent border-0 shadow-none">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <div className="relative w-full max-w-[420px]">
            {/* 
              Redesign: Flex container mimicking the input style. 
              The actual input is transparent and sits next to the icon.
            */}
            <div className="flex h-9 w-full items-center rounded-md border border-input bg-muted/50 px-3 focus-within:ring-2 focus-within:ring-ring focus-within:bg-background transition-all">
              <SearchIcon className="mr-2 h-4 w-4 shrink-0 opacity-50 text-muted-foreground" />
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
                className="flex h-full w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"
              />
              {isLoading ? (
                <Loader2 className="ml-2 h-3 w-3 animate-spin text-muted-foreground" />
              ) : (
                <div className="ml-2 hidden sm:flex items-center gap-1 opacity-50">
                  <kbd className="pointer-events-none h-5 select-none items-center gap-1 rounded bg-background px-1.5 font-mono text-[10px] font-medium shadow-sm border flex">
                    <span className="text-xs">{shortcutKey}</span>K
                  </kbd>
                </div>
              )}
            </div>
          </div>
        </PopoverTrigger>
        <PopoverContent
          className="p-0 w-[var(--radix-popover-trigger-width)] overflow-hidden"
          align="center"
          sideOffset={8}
          onOpenAutoFocus={(e: Event) => e.preventDefault()} // Don't steal focus from input
        >
          <CommandList className="max-h-[500px] py-1">
            {/* Hidden empty state to prevent command from collapsing when empty if we handle it manually? 
                            Shadcn Command usually shows Empty if no items filter match. 
                            Since we use shouldFilter=false, we control items.
                        */}
            <CommandEmpty>
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-muted-foreground">
                <p className="text-sm">No results found for &quot;{query}&quot;</p>
              </div>
            </CommandEmpty>

            {query.length === 0 && (
              <>
                {recentSearches.length > 0 && (
                  <CommandGroup heading="Recent">
                    {recentSearches.map(recent => (
                      <CommandItem
                        key={`${recent.query}-${recent.timestamp}`}
                        value={`recent-${recent.query}`}
                        onSelect={() => handleSelect('', { query: recent.query })}
                        className="aria-selected:bg-accent aria-selected:text-accent-foreground"
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
                      className="aria-selected:bg-accent aria-selected:text-accent-foreground"
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
                {typeOrder.map(type => {
                  const items = groupedResults[type];
                  if (!items?.length) return null;
                  return (
                    <CommandGroup key={type} heading={getTypeLabel(type)}>
                      {items.map(result => (
                        <CommandItem
                          key={result.id}
                          value={`${result.type}-${result.id}-${result.title}`}
                          onSelect={() => handleSelect('', result)}
                          className="aria-selected:bg-accent aria-selected:text-accent-foreground group"
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
                            {result.metadata?.status && (
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
