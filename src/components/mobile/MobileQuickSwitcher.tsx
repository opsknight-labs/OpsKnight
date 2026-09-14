'use client';

import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  FileText,
  Search,
  Server,
  Shield,
  User,
  Users,
  type LucideProps,
} from 'lucide-react';
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
  DialogDescription,
  DialogTitle,
} from '@/components/ui/shadcn/dialog';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { readCache, writeCache } from '@/lib/mobile-cache';
import { appRoutes } from '@/lib/app-routes';

type ResultType = 'incident' | 'service' | 'team' | 'user' | 'policy' | 'postmortem';
type SearchResult = {
  type: ResultType;
  id: string;
  title: string;
  subtitle?: string;
  incidentId?: string;
};
type RecentItem = SearchResult & { timestamp: number };

type TypeMeta = {
  label: string;
  tone: string;
  Icon: ComponentType<LucideProps>;
};

const RECENTS_CACHE_KEY = 'quick-switcher-recents';
const RECENTS_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

const typeMeta: Record<ResultType, TypeMeta> = {
  incident: { label: 'Incident', tone: 'text-rose-600 dark:text-rose-400', Icon: AlertTriangle },
  service: { label: 'Service', tone: 'text-blue-600 dark:text-blue-400', Icon: Server },
  team: { label: 'Team', tone: 'text-teal-600 dark:text-teal-300', Icon: Users },
  user: { label: 'User', tone: 'text-slate-600 dark:text-slate-300', Icon: User },
  policy: { label: 'Policy', tone: 'text-amber-700 dark:text-amber-400', Icon: Shield },
  postmortem: { label: 'Postmortem', tone: 'text-purple-600 dark:text-purple-300', Icon: FileText },
};

const quickLinks = [
  { href: appRoutes.incidents('mobile'), label: 'Incidents' },
  { href: appRoutes.services('mobile'), label: 'Services' },
  { href: appRoutes.teams('mobile'), label: 'Teams' },
  { href: appRoutes.schedules('mobile'), label: 'Schedules' },
];

function mobileHref(result: SearchResult) {
  switch (result.type) {
    case 'incident':
      return appRoutes.incident('mobile', result.id);
    case 'service':
      return appRoutes.service('mobile', result.id);
    case 'team':
      return appRoutes.team('mobile', result.id);
    case 'user':
      return appRoutes.user('mobile', result.id);
    case 'policy':
      return appRoutes.policy('mobile', result.id);
    case 'postmortem':
      return appRoutes.postmortem('mobile', result.id);
  }
}

export default function MobileQuickSwitcher() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [recents, setRecents] = useState<RecentItem[]>([]);
  const searchGeneration = useRef(0);
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
    let cancelled = false;
    if (!open) {
      setQuery('');
      setResults([]);
      setSearchError('');
      return;
    }
    void readCache<RecentItem[]>(RECENTS_CACHE_KEY, RECENTS_MAX_AGE_MS).then(cached => {
      if (!cancelled && Array.isArray(cached)) setRecents(cached.slice(0, 6));
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    const generation = ++searchGeneration.current;
    if (!open || !hasQuery) {
      setResults([]);
      setSearchError('');
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    const handle = window.setTimeout(async () => {
      setIsLoading(true);
      setSearchError('');
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}`, {
          signal: controller.signal,
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(`Search returned HTTP ${response.status}`);
        const data = (await response.json()) as { results?: SearchResult[] };
        if (generation !== searchGeneration.current) return;
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch (error) {
        if (controller.signal.aborted || generation !== searchGeneration.current) return;
        logger.warn('mobile.quick_switcher.search_failed', {
          component: 'MobileQuickSwitcher',
          error,
        });
        setResults([]);
        setSearchError(
          typeof navigator !== 'undefined' && !navigator.onLine
            ? 'Search is unavailable while offline.'
            : 'Search is temporarily unavailable.'
        );
      } finally {
        if (generation === searchGeneration.current) setIsLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(handle);
      controller.abort();
    };
  }, [hasQuery, open, query]);

  const recentItems = useMemo(() => recents.slice(0, 5), [recents]);

  const handleSelect = (item: SearchResult) => {
    const updated = [
      { ...item, timestamp: Date.now() },
      ...recents.filter(recent => !(recent.type === item.type && recent.id === item.id)),
    ].slice(0, 6);
    setRecents(updated);
    void writeCache(RECENTS_CACHE_KEY, updated, { maxAgeMs: RECENTS_MAX_AGE_MS });
    setOpen(false);
    router.push(mobileHref(item));
  };

  return (
    <>
      <button
        type="button"
        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="Search OpsKnight"
        onClick={() => setOpen(true)}
      >
        <Search className="h-4 w-4" aria-hidden="true" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-auto bottom-0 left-0 w-full max-w-none translate-x-0 translate-y-0 gap-0 rounded-t-2xl border-x-0 border-b-0 border-border bg-popover p-0 text-popover-foreground shadow-2xl sm:bottom-auto sm:left-1/2 sm:top-24 sm:w-[min(92vw,32rem)] sm:max-w-lg sm:-translate-x-1/2 sm:rounded-2xl sm:border">
          <DialogTitle className="sr-only">Quick switcher</DialogTitle>
          <DialogDescription className="sr-only">
            Search incidents, services, teams, users, policies and postmortems.
          </DialogDescription>
          <Command shouldFilter={false} className="bg-transparent">
            <CommandInput
              placeholder="Search incidents, services, teams…"
              value={query}
              onValueChange={setQuery}
              autoFocus
            />
            <CommandList className="max-h-[min(68dvh,32rem)] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <CommandEmpty>
                {isLoading ? 'Searching…' : searchError || 'No results found.'}
              </CommandEmpty>

              {!hasQuery ? (
                <>
                  {recentItems.length > 0 ? (
                    <CommandGroup heading="Recent">
                      {recentItems.map(item => {
                        const meta = typeMeta[item.type];
                        return (
                          <CommandItem
                            key={`${item.type}-${item.id}`}
                            onSelect={() => handleSelect(item)}
                            className="min-h-11 gap-3 py-3"
                          >
                            <meta.Icon className={cn('h-4 w-4 shrink-0', meta.tone)} aria-hidden="true" />
                            <div className="min-w-0 flex-1">
                              <span className="block truncate font-medium">{item.title}</span>
                              {item.subtitle ? (
                                <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
                              ) : null}
                            </div>
                            <span className="text-[10px] uppercase text-muted-foreground">{meta.label}</span>
                          </CommandItem>
                        );
                      })}
                      <CommandSeparator />
                    </CommandGroup>
                  ) : null}
                  <CommandGroup heading="Explore">
                    {quickLinks.map(link => (
                      <CommandItem
                        key={link.href}
                        onSelect={() => {
                          setOpen(false);
                          router.push(link.href);
                        }}
                        className="min-h-11 py-3"
                      >
                        <Search className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        <span className="font-medium">{link.label}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              ) : null}

              {hasQuery && results.length > 0 ? (
                <CommandGroup heading="Results">
                  {results.map(item => {
                    const meta = typeMeta[item.type];
                    return (
                      <CommandItem
                        key={`${item.type}-${item.id}`}
                        onSelect={() => handleSelect(item)}
                        className="min-h-11 gap-3 py-3"
                      >
                        <meta.Icon className={cn('h-4 w-4 shrink-0', meta.tone)} aria-hidden="true" />
                        <div className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{item.title}</span>
                          {item.subtitle ? (
                            <span className="block truncate text-xs text-muted-foreground">{item.subtitle}</span>
                          ) : null}
                        </div>
                        <span className="text-[10px] uppercase text-muted-foreground">{meta.label}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
