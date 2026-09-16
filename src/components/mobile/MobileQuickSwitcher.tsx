'use client';

import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  AlertTriangle,
  FileText,
  Search,
  Server,
  Shield,
  User,
  Users,
  X,
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
import MobileHeaderAction from '@/components/mobile/MobileHeaderAction';
import { useKeyboardSafeSheetGeometry } from '@/hooks/useKeyboardSafeSheetGeometry';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger';
import { readCache, writeCache } from '@/lib/mobile-cache';
import { appRoutes } from '@/lib/app-routes';
import { fetchWithTimeout } from '@/lib/client-timeout';

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
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const { maxHeight: sheetMaxHeight, bottomOffset: sheetBottomOffset } =
    useKeyboardSafeSheetGeometry(open);
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
        const response = await fetchWithTimeout(
          `/api/search?q=${encodeURIComponent(query.trim())}`,
          {
            signal: controller.signal,
            cache: 'no-store',
          },
          8_000
        );
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
      <MobileHeaderAction
        ref={triggerRef}
        icon={<Search className="h-5 w-5" aria-hidden="true" />}
        label="Search OpsKnight"
        onClick={() => setOpen(true)}
      />

      <DialogPrimitive.Root
        open={open}
        onOpenChange={next => {
          setOpen(next);
          if (!next) triggerRef.current?.focus();
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none" />
          <DialogPrimitive.Content
            className="fixed inset-x-0 z-50 flex flex-col overflow-hidden rounded-t-3xl border border-border bg-popover text-popover-foreground shadow-2xl duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-bottom-8 data-[state=open]:slide-in-from-bottom-8 data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none motion-reduce:transition-none"
            style={{
              maxHeight: sheetMaxHeight ? `${sheetMaxHeight}px` : 'calc(100dvh - 0.75rem)',
              bottom: sheetBottomOffset,
            }}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
              <DialogPrimitive.Title className="text-sm font-semibold text-foreground">
                Search
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">
                Search incidents, services, teams, users, policies and postmortems.
              </DialogPrimitive.Description>
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  aria-label="Close search"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </DialogPrimitive.Close>
            </div>

            <Command shouldFilter={false} className="flex min-h-0 flex-1 flex-col bg-transparent">
              <CommandInput
                placeholder="Search incidents, services, teams…"
                value={query}
                onValueChange={setQuery}
                className="h-12 text-base"
                autoFocus
              />
              <CommandList className="flex-1 overflow-y-auto pb-[max(0.75rem,env(safe-area-inset-bottom,0px))]">
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
                              className="min-h-12 gap-3 py-3"
                            >
                              <meta.Icon
                                className={cn('h-4 w-4 shrink-0', meta.tone)}
                                aria-hidden="true"
                              />
                              <div className="min-w-0 flex-1">
                                <span className="block truncate font-medium">{item.title}</span>
                                {item.subtitle ? (
                                  <span className="block truncate text-xs text-muted-foreground">
                                    {item.subtitle}
                                  </span>
                                ) : null}
                              </div>
                              <span className="text-[10px] uppercase text-muted-foreground">
                                {meta.label}
                              </span>
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
                          className="min-h-12 py-3"
                        >
                          <Search
                            className="mr-2 h-4 w-4 text-muted-foreground"
                            aria-hidden="true"
                          />
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
                          className="min-h-12 gap-3 py-3"
                        >
                          <meta.Icon
                            className={cn('h-4 w-4 shrink-0', meta.tone)}
                            aria-hidden="true"
                          />
                          <div className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{item.title}</span>
                            {item.subtitle ? (
                              <span className="block truncate text-xs text-muted-foreground">
                                {item.subtitle}
                              </span>
                            ) : null}
                          </div>
                          <span className="text-[10px] uppercase text-muted-foreground">
                            {meta.label}
                          </span>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                ) : null}
              </CommandList>
            </Command>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
