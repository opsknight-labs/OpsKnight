'use client';

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useRouter } from 'next/navigation';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/shadcn/command';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/shadcn/dialog';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { Search } from 'lucide-react';

type ResultType = 'incident' | 'service' | 'team' | 'user' | 'policy' | 'postmortem';

type SearchResult = {
  type: ResultType;
  id: string;
  title: string;
  subtitle?: string;
  incidentId?: string;
};

type RecentItem = SearchResult & { timestamp: number };

const RECENTS_KEY = 'mobileQuickSwitcherRecents';
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

const typeLabels: Record<ResultType, string> = {
  incident: 'Incident',
  service: 'Service',
  team: 'Team',
  user: 'User',
  policy: 'Policy',
  postmortem: 'Postmortem',
};

const typeTones: Record<ResultType, string> = {
  incident: 'danger',
  service: 'blue',
  team: 'teal',
  user: 'slate',
  policy: 'amber',
  postmortem: 'purple',
};

const typeIcons: Record<ResultType, ReactElement> = {
  incident: (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path d="M12 3l9 16H3l9-16Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 9v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  ),
  service: (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <rect x="4" y="5" width="16" height="6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <rect x="4" y="13" width="16" height="6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  ),
  team: (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17" cy="9" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 20c0-3 3-5 6-5s6 2 6 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  user: (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  policy: (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3Z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  postmortem: (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
      <path d="M7 3h7l4 4v14H7z" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M14 3v5h5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 13h6M9 17h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
};

const quickLinks = [
  { href: '/m/incidents', label: 'Incidents' },
  { href: '/m/services', label: 'Services' },
  { href: '/m/teams', label: 'Teams' },
  { href: '/m/schedules', label: 'Schedules' },
];

const toneClasses: Record<string, string> = {
  danger: 'text-red-600 dark:text-red-400',
  blue: 'text-blue-600 dark:text-blue-400',
  teal: 'text-teal-600 dark:text-teal-300',
  slate: 'text-slate-600 dark:text-slate-300',
  amber: 'text-amber-700 dark:text-amber-400',
  purple: 'text-purple-600 dark:text-purple-300',
};

function mapToMobileHref(result: SearchResult) {
  switch (result.type) {
    case 'incident': return `/m/incidents/${result.id}`;
    case 'service': return `/m/services/${result.id}`;
    case 'team': return `/m/teams/${result.id}`;
    case 'user': return `/m/users/${result.id}`;
    case 'policy': return `/m/policies/${result.id}`;
    case 'postmortem': return `/m/postmortems/${result.id}`;
    default: return '/m';
  }
}

function readRecents(): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = window.localStorage.getItem(RECENTS_KEY);
    if (!stored) return [];
    const parsed = JSON.parse(stored) as RecentItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeRecents(items: RecentItem[]) {
  try {
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(items));
  } catch {
    // Recents are optional; storage failures must not block navigation.
  }
}

export default function MobileQuickSwitcher() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [recents, setRecents] = useState<RecentItem[]>([]);
  const router = useRouter();

  const hasQuery = query.trim().length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen(value => !value);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  useEffect(() => {
    if (open) setRecents(readRecents());
    else {
      setQuery('');
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !hasQuery) {
      setResults([]);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Search request failed');
        const data = await response.json();
        setResults((data?.results || []) as SearchResult[]);
      } catch (error: unknown) {
        if ((error as Error).name !== 'AbortError') {
          logger.error('mobile.quickSwitcher.searchFailed', { component: 'MobileQuickSwitcher', error });
        }
      } finally {
        setIsLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [open, query, hasQuery]);

  const recentItems = useMemo(() => recents.slice(0, 5), [recents]);

  const handleSelect = (item: SearchResult) => {
    const updated = [
      { ...item, timestamp: Date.now() },
      ...recents.filter(recent => !(recent.type === item.type && recent.id === item.id)),
    ].slice(0, 6);
    setRecents(updated);
    writeRecents(updated);
    setOpen(false);
    router.push(mapToMobileHref(item));
  };

  const handleQuickLink = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      <button
        type="button"
        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Search OpsKnight"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-auto bottom-0 left-0 w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-t-2xl border-x-0 border-b-0 border-border bg-popover p-0 text-popover-foreground shadow-2xl sm:bottom-auto sm:left-1/2 sm:top-24 sm:w-[min(92vw,32rem)] sm:max-w-lg sm:-translate-x-1/2 sm:rounded-2xl sm:border">
          <DialogTitle className="sr-only">Quick switcher</DialogTitle>
          <DialogDescription className="sr-only">Search incidents, services, teams, and more.</DialogDescription>
          <Command shouldFilter={false} className="bg-transparent">
            <CommandInput
              placeholder="Search incidents, services, teams…"
              value={query}
              onValueChange={setQuery}
              autoFocus
            />
            <CommandList className="max-h-[min(68dvh,32rem)] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <CommandEmpty>{isLoading ? 'Searching…' : 'No results found.'}</CommandEmpty>

              {!hasQuery && (
                <>
                  {recentItems.length > 0 && (
                    <CommandGroup heading="Recent">
                      {recentItems.map(item => (
                        <CommandItem key={`${item.type}-${item.id}`} onSelect={() => handleSelect(item)} className="gap-3 py-3">
                          <span className={cn('flex shrink-0', toneClasses[typeTones[item.type]])}>{typeIcons[item.type]}</span>
                          <div className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{item.title}</span>
                            {item.subtitle && <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>}
                          </div>
                          <span className="text-[10px] uppercase text-muted-foreground">{typeLabels[item.type]}</span>
                        </CommandItem>
                      ))}
                      <CommandSeparator />
                    </CommandGroup>
                  )}

                  <CommandGroup heading="Explore">
                    {quickLinks.map(link => (
                      <CommandItem key={link.href} onSelect={() => handleQuickLink(link.href)} className="py-3">
                        <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <span className="font-medium">{link.label}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}

              {hasQuery && results.length > 0 && (
                <CommandGroup heading="Results">
                  {results.map(item => (
                    <CommandItem key={`${item.type}-${item.id}`} onSelect={() => handleSelect(item)} className="gap-3 py-3">
                      <span className={cn('flex shrink-0', toneClasses[typeTones[item.type]])}>{typeIcons[item.type]}</span>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{item.title}</span>
                        {item.subtitle && <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>}
                      </div>
                      <span className="text-[10px] uppercase text-muted-foreground">{typeLabels[item.type]}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
