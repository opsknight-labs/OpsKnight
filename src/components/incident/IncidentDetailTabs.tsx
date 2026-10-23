'use client';

import React, { useEffect, useState, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { Badge } from '@/components/ui/shadcn/badge';
import { Settings2, History, Zap, FileText, Workflow, Route, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';

export type IncidentDetailTabsProps = {
  defaultTab?: string;
  eventCount: number;
  noteCount?: number;
  activityContent: ReactNode;
  timelineContent: ReactNode;
  automationContent?: ReactNode;
  responseContent?: ReactNode;
  runbooksContent?: ReactNode;
  postmortemContent?: ReactNode;
  postmortemStatus?: string | null;
  className?: string;
};

/** Maps record anchors used by the Response activity view to the tab that renders them. */
export function tabForAnchor(
  anchor: string,
  hasRunbooksOrOptions: boolean | { hasRunbooks?: boolean; hasAutomation?: boolean } = {}
): string | null {
  const opts =
    typeof hasRunbooksOrOptions === 'boolean'
      ? { hasRunbooks: hasRunbooksOrOptions, hasAutomation: true }
      : {
          hasRunbooks: hasRunbooksOrOptions.hasRunbooks ?? false,
          hasAutomation: hasRunbooksOrOptions.hasAutomation ?? true,
        };
  if (anchor.startsWith('timeline-')) return 'timeline';
  if (anchor.startsWith('runbook-')) return opts.hasRunbooks ? 'runbooks' : null;
  if (anchor === 'response-activity') return 'response';
  if (anchor === 'automation-decision' || anchor.startsWith('automation-')) {
    return opts.hasAutomation ? 'automation' : null;
  }
  return null;
}

export function isIncidentTabAvailable(
  tabId: string,
  options: {
    hasResponse?: boolean;
    hasRunbooks?: boolean;
    hasPostmortem?: boolean;
    hasAutomation?: boolean;
  }
): boolean {
  switch (tabId) {
    case 'overview':
    case 'timeline':
      return true;
    case 'automation':
      return Boolean(options.hasAutomation);
    case 'response':
      return Boolean(options.hasResponse);
    case 'runbooks':
      return Boolean(options.hasRunbooks);
    case 'postmortem':
      return Boolean(options.hasPostmortem);
    default:
      return false;
  }
}

export default function IncidentDetailTabs({
  defaultTab = 'overview',
  eventCount,
  activityContent,
  timelineContent,
  automationContent,
  responseContent,
  runbooksContent,
  postmortemContent,
  postmortemStatus,
  className,
}: IncidentDetailTabsProps) {
  const hasAutomation = !!automationContent;
  const hasRunbooks = !!runbooksContent;
  const hasResponse = !!responseContent;
  const hasPostmortem = !!postmortemContent;

  const isAvailable = React.useCallback(
    (t: string) =>
      isIncidentTabAvailable(t, { hasAutomation, hasResponse, hasRunbooks, hasPostmortem }),
    [hasAutomation, hasResponse, hasRunbooks, hasPostmortem]
  );

  const [tab, setTab] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('tab');
      if (p && isAvailable(p)) {
        return p;
      }
    }
    return defaultTab && isAvailable(defaultTab) ? defaultTab : 'overview';
  });

  if (!isAvailable(tab) && tab !== 'overview') {
    setTab('overview');
  }

  useEffect(() => {
    const handlePopState = () => {
      const p = new URLSearchParams(window.location.search).get('tab');
      if (p && isAvailable(p)) {
        setTab(p);
      } else {
        setTab('overview');
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isAvailable]);

  useEffect(() => {
    const sync = () => {
      const anchor = decodeURIComponent(window.location.hash.slice(1));
      const target = tabForAnchor(anchor, { hasRunbooks, hasAutomation });
      if (!target || !isAvailable(target)) return;
      setTab(target);
      // Wait for the newly selected tab panel to mount before scrolling.
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() =>
          document.getElementById(anchor)?.scrollIntoView({ block: 'center' })
        )
      );
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [hasRunbooks, hasAutomation, isAvailable]);

  const handleTabChange = (nextTab: string) => {
    if (!isAvailable(nextTab)) return;
    setTab(nextTab);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (nextTab === 'overview') {
        params.delete('tab');
      } else {
        params.set('tab', nextTab);
      }
      const query = params.toString();
      const newUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
      window.history.replaceState(null, '', newUrl);
    }
  };

  return (
    <Tabs value={tab} onValueChange={handleTabChange} className={cn('w-full', className)}>
      <div className="rounded-xl border border-border bg-card shadow-2xs overflow-hidden text-card-foreground transition-all">
        {/* Modern, Fluid Segmented Tabs Header */}
        <div className="border-b border-border/70 bg-muted/25 px-2.5 sm:px-3.5 py-2 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden touch-pan-x">
            <TabsList className="inline-flex h-8 items-center justify-start gap-1 p-0.5 bg-muted/60 dark:bg-muted/30 border border-border/50 rounded-lg w-max">
              <TabsTrigger
                value="overview"
                className="shrink-0 gap-1.5 px-3 py-1 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all select-none"
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span>Overview</span>
              </TabsTrigger>
              {automationContent && (
                <TabsTrigger
                  value="automation"
                  className="shrink-0 gap-1.5 px-3 py-1 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all select-none"
                >
                  <Workflow className="h-3.5 w-3.5" />
                  <span>Automation</span>
                </TabsTrigger>
              )}
              {responseContent && (
                <TabsTrigger
                  value="response"
                  className="shrink-0 gap-1.5 px-3 py-1 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all select-none"
                >
                  <Route className="h-3.5 w-3.5" />
                  <span>Response activity</span>
                </TabsTrigger>
              )}
              {runbooksContent && (
                <TabsTrigger
                  value="runbooks"
                  className="shrink-0 gap-1.5 px-3 py-1 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all select-none"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  <span>Runbooks</span>
                </TabsTrigger>
              )}
              <TabsTrigger
                value="timeline"
                className="shrink-0 gap-1.5 px-3 py-1 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all select-none"
              >
                <History className="h-3.5 w-3.5" />
                <span>Timeline</span>
                {typeof eventCount === 'number' && (
                  <span className="ml-1 inline-flex items-center rounded-full bg-muted-foreground/15 px-1.5 py-0.2 text-[10px] font-semibold text-muted-foreground">
                    {eventCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger
                value="postmortem"
                className="shrink-0 gap-1.5 px-3 py-1 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs transition-all select-none"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Postmortem</span>
                {postmortemStatus && (
                  <span
                    className={cn(
                      'inline-block w-1.5 h-1.5 rounded-full ml-0.5',
                      postmortemStatus === 'PUBLISHED'
                        ? 'bg-emerald-500 ring-2 ring-emerald-500/20'
                        : 'bg-amber-500 ring-2 ring-amber-500/20'
                    )}
                    title={`Status: ${postmortemStatus}`}
                  />
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {typeof eventCount === 'number' && (
            <Badge
              variant="outline"
              className="hidden 2xl:inline-flex gap-1.5 py-1 px-2.5 border-border bg-background/80 shrink-0 text-xs font-medium"
            >
              <Zap className="h-3.5 w-3.5 text-amber-500" />
              <span>{eventCount} Events</span>
            </Badge>
          )}
        </div>

        {/* Tab Content */}
        <div className="p-4 sm:p-5">
          <TabsContent value="overview" className="mt-0 space-y-6 focus-visible:outline-none">
            {activityContent}
          </TabsContent>

          {automationContent && (
            <TabsContent value="automation" className="mt-0 space-y-4 focus-visible:outline-none">
              {automationContent}
            </TabsContent>
          )}

          {responseContent && (
            <TabsContent value="response" className="mt-0 focus-visible:outline-none">
              {responseContent}
            </TabsContent>
          )}

          <TabsContent value="timeline" className="mt-0 focus-visible:outline-none">
            {timelineContent}
          </TabsContent>

          {runbooksContent && (
            <TabsContent value="runbooks" className="mt-0 focus-visible:outline-none">
              {runbooksContent}
            </TabsContent>
          )}

          <TabsContent value="postmortem" className="mt-0 focus-visible:outline-none">
            {postmortemContent}
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}
