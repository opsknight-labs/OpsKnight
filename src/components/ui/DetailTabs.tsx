'use client';

import React, {
  useCallback,
  useMemo,
  useState,
  useEffect,
  useRef,
  Suspense,
  type ReactNode,
} from 'react';
import { usePathname, useSearchParams, useRouter } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

function TabUrlSync({
  urlParamName,
  validTabIds,
  onUrlTabChange,
}: {
  urlParamName: string;
  validTabIds: Set<string>;
  onUrlTabChange: (tab: string) => void;
}) {
  const searchParams = useSearchParams();
  const lastParamRef = useRef<string | null>(null);
  const onUrlTabChangeRef = useRef(onUrlTabChange);
  useEffect(() => {
    onUrlTabChangeRef.current = onUrlTabChange;
  }, [onUrlTabChange]);

  useEffect(() => {
    if (!searchParams) return;
    const urlTab = searchParams.get(urlParamName);
    if (urlTab && validTabIds.has(urlTab) && urlTab !== lastParamRef.current) {
      lastParamRef.current = urlTab;
      onUrlTabChangeRef.current(urlTab);
    }
  }, [searchParams, urlParamName, validTabIds]);
  return null;
}

export type DetailTabItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: number | string;
  badge?: ReactNode;
  content?: ReactNode;
  /** Keep the content mounted (hidden) while another tab is active, preserving unsaved state. */
  keepMounted?: boolean;
  disabled?: boolean;
};

export type DetailTabsProps = {
  tabs: DetailTabItem[];
  defaultTab?: string;
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  syncWithUrl?: boolean;
  navigationMode?: 'shallow' | 'server';
  urlParamName?: string;
  layout?: 'grid' | 'auto';
  className?: string;
  listClassName?: string;
  /** Names the tab list and the small-screen picker ("Section: Overview"). */
  label?: string;
  contentClassName?: string;
  actions?: ReactNode;
  children?: ReactNode;
};

const iconSlot = 'flex shrink-0 items-center [&_svg]:h-4 [&_svg]:w-4';

function TabMeta({ tab }: { tab: DetailTabItem }) {
  return (
    <>
      {tab.count !== undefined && tab.count !== null && (
        <span className="rounded-full bg-muted-foreground/15 px-1.5 text-xs font-medium tabular-nums text-muted-foreground group-data-[state=active]:bg-primary/10 group-data-[state=active]:text-primary">
          {tab.count}
        </span>
      )}
      {tab.badge && <span className="flex shrink-0 items-center">{tab.badge}</span>}
    </>
  );
}

function SectionPicker({
  tabs,
  value,
  label,
  onSelect,
}: {
  tabs: DetailTabItem[];
  value: string;
  label: string;
  onSelect: (tabId: string) => void;
}) {
  const current = tabs.find(t => t.id === value) ?? tabs[0];
  if (!current) return null;
  return (
    <div className="md:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`${label}: ${current.label}`}
            className="flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-left text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {current.icon && (
              <span className={cn(iconSlot, 'text-muted-foreground')}>{current.icon}</span>
            )}
            <span className="min-w-0 truncate">{current.label}</span>
            <TabMeta tab={current} />
            <ChevronsUpDown
              aria-hidden="true"
              className="ml-auto h-4 w-4 shrink-0 text-muted-foreground"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-[var(--radix-dropdown-menu-trigger-width)] max-w-[calc(100vw-2rem)]"
        >
          <DropdownMenuRadioGroup value={value} onValueChange={onSelect}>
            {tabs.map(tab => (
              <DropdownMenuRadioItem
                key={tab.id}
                value={tab.id}
                disabled={tab.disabled}
                className="gap-2"
              >
                {tab.icon && (
                  <span className={cn(iconSlot, 'text-muted-foreground')}>{tab.icon}</span>
                )}
                <span className="min-w-0 flex-1 truncate">{tab.label}</span>
                <TabMeta tab={tab} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ScrollableTabList({
  tabs,
  value,
  layout,
  label,
  className,
}: {
  tabs: DetailTabItem[];
  value: string;
  layout: 'grid' | 'auto';
  label?: string;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  const updateFade = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setFade(prev => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    updateFade();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateFade);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [updateFade]);

  // Keep the active tab visible. Scroll only the strip (not scrollIntoView) so the page never jumps.
  useEffect(() => {
    const el = scrollerRef.current;
    const active = el?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!el || !active) return;
    const box = el.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    if (tab.left < box.left) el.scrollLeft -= box.left - tab.left + 24;
    else if (tab.right > box.right) el.scrollLeft += tab.right - box.right + 24;
  }, [value]);

  return (
    <div className="relative hidden min-w-0 flex-1 md:block">
      <div
        ref={scrollerRef}
        onScroll={updateFade}
        className="overflow-x-auto rounded-lg [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <TabsList
          aria-label={label}
          className={cn(
            'flex h-auto w-max min-w-full flex-nowrap items-center justify-start gap-1 rounded-lg bg-muted p-1',
            className
          )}
        >
          {tabs.map(tab => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              disabled={tab.disabled}
              className={cn(
                'group h-9 shrink-0 gap-2 rounded-md px-3 py-0 text-sm font-medium text-muted-foreground',
                'hover:text-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-border',
                layout === 'grid' && 'flex-1'
              )}
            >
              {tab.icon && (
                <span className={cn(iconSlot, 'group-data-[state=active]:text-primary')}>
                  {tab.icon}
                </span>
              )}
              <span>{tab.label}</span>
              <TabMeta tab={tab} />
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {fade.left && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-10 rounded-l-lg bg-gradient-to-r from-muted to-transparent"
        />
      )}
      {fade.right && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-lg bg-gradient-to-l from-muted to-transparent"
        />
      )}
    </div>
  );
}

export default function DetailTabs({
  tabs,
  defaultTab,
  activeTab: controlledActiveTab,
  onTabChange,
  syncWithUrl = true,
  navigationMode = 'shallow',
  urlParamName = 'tab',
  layout = 'grid',
  className,
  listClassName,
  label,
  contentClassName,
  actions,
  children,
}: DetailTabsProps) {
  const router = useRouter();
  const pathname = usePathname();

  const validTabIds = useMemo(() => new Set(tabs.map(t => t.id)), [tabs]);
  const fallbackDefaultTab = tabs[0]?.id || 'overview';
  const initialTab = defaultTab && validTabIds.has(defaultTab) ? defaultTab : fallbackDefaultTab;

  // Optimistic local state for instantaneous 0ms tab switching & zero lag
  const [selectedTab, setSelectedTab] = useState(controlledActiveTab || initialTab);
  const selection = useRef(selectedTab);

  const [prevControlledActiveTab, setPrevControlledActiveTab] = useState(controlledActiveTab);
  if (controlledActiveTab !== prevControlledActiveTab) {
    setPrevControlledActiveTab(controlledActiveTab);
    if (controlledActiveTab) {
      setSelectedTab(controlledActiveTab);
    }
  }

  useEffect(() => {
    if (controlledActiveTab) {
      selection.current = controlledActiveTab;
    }
  }, [controlledActiveTab]);

  // Listen to popstate (browser back/forward) to update optimistic state
  useEffect(() => {
    if (!syncWithUrl) return;

    const handlePopState = () => {
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const urlTab = urlParams.get(urlParamName);
        const targetTab = urlTab && validTabIds.has(urlTab) ? urlTab : initialTab;
        selection.current = targetTab;
        setSelectedTab(targetTab);
        if (onTabChange) {
          onTabChange(targetTab);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [syncWithUrl, urlParamName, validTabIds, initialTab, onTabChange]);

  const currentTab = controlledActiveTab || selectedTab;

  const handleTabChange = (nextTabId: string) => {
    if (nextTabId === currentTab) return;
    // Debounce duplicate in-flight activations for the same pending tab
    if (nextTabId === selection.current && nextTabId !== currentTab) return;
    if (syncWithUrl && typeof window !== 'undefined') {
      const change = new CustomEvent('opsknight:settings-navigation', {
        cancelable: true,
        detail: { parameter: urlParamName, value: nextTabId },
      });
      if (!window.dispatchEvent(change)) return;
    }
    // 1. Instant 0ms local state update (immediate visual tab highlight & content switch)
    selection.current = nextTabId;
    setSelectedTab(nextTabId);

    if (onTabChange) {
      onTabChange(nextTabId);
    }

    // 2. Non-blocking shallow URL synchronization (zero network roundtrip delay)
    if (syncWithUrl) {
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search);
        if (nextTabId === fallbackDefaultTab) {
          params.delete(urlParamName);
        } else {
          params.set(urlParamName, nextTabId);
        }
        const queryString = params.toString();
        const newUrl = queryString ? `${pathname}?${queryString}` : pathname;

        // Use window.history.replaceState for instant URL bar update without triggering blocking RSC re-fetch
        if (navigationMode === 'server') router.replace(newUrl, { scroll: false });
        else window.history.replaceState(null, '', newUrl);
      }
    }
  };

  return (
    <>
      {syncWithUrl && navigationMode !== 'server' && controlledActiveTab === undefined && (
        <Suspense fallback={null}>
          <TabUrlSync
            urlParamName={urlParamName}
            validTabIds={validTabIds}
            onUrlTabChange={tab => {
              selection.current = tab;
              setSelectedTab(tab);
              if (onTabChange) {
                onTabChange(tab);
              }
            }}
          />
        </Suspense>
      )}
      <Tabs
        value={currentTab}
        onValueChange={handleTabChange}
        className={cn('space-y-6', className)}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          {/* Below md: one full-width section picker instead of a cramped/wrapping row. */}
          <SectionPicker
            tabs={tabs}
            value={currentTab}
            label={label ?? 'Section'}
            onSelect={handleTabChange}
          />
          <ScrollableTabList
            tabs={tabs}
            value={currentTab}
            layout={layout}
            label={label}
            className={listClassName}
          />
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>

        {/* Render children or tab contents with smooth transition animation */}
        {children
          ? children
          : tabs.map(tab =>
              tab.content ? (
                <TabsContent
                  key={tab.id}
                  value={tab.id}
                  forceMount={tab.keepMounted ? true : undefined}
                  className={cn(
                    'focus-visible:outline-hidden data-[state=active]:animate-in data-[state=active]:fade-in-50 data-[state=active]:slide-in-from-bottom-1 data-[state=active]:duration-200',
                    tab.keepMounted && 'data-[state=inactive]:hidden',
                    contentClassName
                  )}
                >
                  {tab.content}
                </TabsContent>
              ) : null
            )}
      </Tabs>
    </>
  );
}

export { TabsContent as DetailTabContent };
