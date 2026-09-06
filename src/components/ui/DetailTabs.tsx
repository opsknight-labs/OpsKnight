'use client';

import React, { useMemo, useState, useEffect, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { cn } from '@/lib/utils';

export type DetailTabItem = {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: number | string;
  badge?: ReactNode;
  content?: ReactNode;
  disabled?: boolean;
};

export type DetailTabsProps = {
  tabs: DetailTabItem[];
  defaultTab?: string;
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  syncWithUrl?: boolean;
  urlParamName?: string;
  layout?: 'grid' | 'auto';
  className?: string;
  listClassName?: string;
  contentClassName?: string;
  actions?: ReactNode;
  children?: ReactNode;
};

export default function DetailTabs({
  tabs,
  defaultTab,
  activeTab: controlledActiveTab,
  onTabChange,
  syncWithUrl = true,
  urlParamName = 'tab',
  layout = 'grid',
  className,
  listClassName,
  contentClassName,
  actions,
  children,
}: DetailTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const validTabIds = useMemo(() => new Set(tabs.map(t => t.id)), [tabs]);
  const fallbackDefaultTab = tabs[0]?.id || 'overview';
  const initialTab = defaultTab && validTabIds.has(defaultTab) ? defaultTab : fallbackDefaultTab;

  // Resolve current active tab from URL or defaults
  const resolvedUrlTab = useMemo(() => {
    if (controlledActiveTab) return controlledActiveTab;
    if (syncWithUrl && searchParams) {
      const urlTab = searchParams.get(urlParamName);
      if (urlTab && validTabIds.has(urlTab)) {
        return urlTab;
      }
    }
    return initialTab;
  }, [controlledActiveTab, syncWithUrl, searchParams, urlParamName, validTabIds, initialTab]);

  // Optimistic local state for instantaneous 0ms tab switching & zero lag
  const [selectedTab, setSelectedTab] = useState(resolvedUrlTab);

  // Synchronize internal state if controlled tab or external URL query param changes
  useEffect(() => {
    setSelectedTab(resolvedUrlTab);
  }, [resolvedUrlTab]);

  // Listen to popstate (browser back/forward) to update optimistic state
  useEffect(() => {
    if (!syncWithUrl) return;

    const handlePopState = () => {
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const urlTab = urlParams.get(urlParamName);
        if (urlTab && validTabIds.has(urlTab)) {
          setSelectedTab(urlTab);
        } else {
          setSelectedTab(initialTab);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [syncWithUrl, urlParamName, validTabIds, initialTab]);

  const handleTabChange = (nextTabId: string) => {
    // 1. Instant 0ms local state update (immediate visual tab highlight & content switch)
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
        window.history.replaceState(null, '', newUrl);
      }
    }
  };

  const currentTab = controlledActiveTab || selectedTab;

  return (
    <Tabs value={currentTab} onValueChange={handleTabChange} className={cn('space-y-6', className)}>
      {/* Centralized Elevated Navigation Header */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="overflow-x-auto pb-1 scrollbar-none">
          <TabsList
            className={cn(
              'h-auto rounded-xl border border-border/80 bg-muted/40 p-1 backdrop-blur-xs shadow-2xs',
              layout === 'grid' && [
                'grid min-w-[540px]',
                tabs.length === 2 && 'grid-cols-2',
                tabs.length === 3 && 'grid-cols-3',
                tabs.length === 4 && 'grid-cols-4',
                tabs.length === 5 && 'grid-cols-5',
                tabs.length >= 6 && 'grid-cols-6',
              ],
              layout === 'auto' && 'inline-flex min-w-full sm:min-w-0 gap-1',
              listClassName
            )}
          >
            {tabs.map(tab => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                disabled={tab.disabled}
                className={cn(
                  'group relative flex items-center justify-center gap-2 rounded-lg py-2.5 px-3.5 text-xs font-medium transition-all duration-150 cursor-pointer',
                  'text-muted-foreground hover:text-foreground hover:bg-background/50',
                  'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:font-semibold data-[state=active]:shadow-xs data-[state=active]:ring-1 data-[state=active]:ring-border/60'
                )}
              >
                {tab.icon && (
                  <span className="shrink-0 transition-colors group-data-[state=active]:text-primary">
                    {tab.icon}
                  </span>
                )}
                <span className="truncate">{tab.label}</span>

                {/* Count Pill */}
                {tab.count !== undefined && tab.count !== null && (
                  <span
                    className={cn(
                      'ml-0.5 rounded-full px-1.5 py-0.2 text-[10px] font-semibold transition-colors',
                      'bg-muted-foreground/10 text-muted-foreground',
                      'group-data-[state=active]:bg-primary/10 group-data-[state=active]:text-primary group-data-[state=active]:font-bold'
                    )}
                  >
                    {tab.count}
                  </span>
                )}

                {/* Custom Badge Tag */}
                {tab.badge && <span className="ml-1 shrink-0">{tab.badge}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {/* Optional Right Action Slot */}
        {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
      </div>

      {/* Render children or tab contents with smooth transition animation */}
      {children
        ? children
        : tabs.map(tab =>
            tab.content ? (
              <TabsContent
                key={tab.id}
                value={tab.id}
                className={cn(
                  'focus-visible:outline-hidden data-[state=active]:animate-in data-[state=active]:fade-in-50 data-[state=active]:slide-in-from-bottom-1 data-[state=active]:duration-200',
                  contentClassName
                )}
              >
                {tab.content}
              </TabsContent>
            ) : null
          )}
    </Tabs>
  );
}

export { TabsContent as DetailTabContent };
