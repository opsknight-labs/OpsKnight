'use client';

import React, { useEffect, useState, type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import {
  Bell,
  ChevronsUpDown,
  History,
  FileText,
  LayoutList,
  Workflow,
  MessageSquareText,
  Route,
  ListTree,
  ScrollText,
  SlidersHorizontal,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/shadcn/dropdown-menu';
import { cn } from '@/lib/utils';

export type IncidentDetailTabsProps = {
  defaultTab?: string;
  /** Kept for callers; the Timeline tab carries no count because its rows mix several sources. */
  eventCount?: number;
  noteCount?: number;
  /** The Notes tab: the composer and the notes responders write for each other. */
  activityContent: ReactNode;
  timelineContent: ReactNode;
  automationContent?: ReactNode;
  /** Response path (routing → paging → remediation → recovery); a view inside the Timeline tab. */
  responseContent?: ReactNode;
  /** Every alert on the incident with its readable payload; a view inside the Timeline tab. */
  alertsContent?: ReactNode;
  /** Who changed what (people, automation, Squire, API/MCP); a view inside the Timeline tab, loaded on open. */
  auditContent?: ReactNode;
  /** Runbooks for this incident; a section of the Automation tab. */
  runbooksContent?: ReactNode;
  postmortemContent?: ReactNode;
  /** Postmortem tab only once there is something to write: the incident is resolved or a draft exists. */
  showPostmortem?: boolean;
  postmortemStatus?: string | null;
  className?: string;
  /**
   * 'card' (desktop): one card with Notes, Timeline, Runbooks & automation, Postmortem.
   * 'sections' (phone app): a sticky five-part bar — Overview, Timeline, Notes, Runbooks, Details — that
   * splits the whole page into short screens; postmortem opens from the bottom bar instead.
   */
  layout?: 'card' | 'sections';
  /** Sections layout: what to read first (briefing, responders, customer updates, description). */
  overviewContent?: ReactNode;
  /** Sections layout: properties, tags, Jira, war rooms, custom fields, subscribers, links. */
  detailsContent?: ReactNode;
};

/**
 * Tab ids from before the merge (Overview, Response activity, Runbooks) still arrive in links and
 * bookmarks; each opens the tab that now holds its content.
 */
const TAB_ALIASES: Record<string, string> = {
  overview: 'notes',
  response: 'timeline',
  runbooks: 'automation',
};

export function canonicalTab(tabId: string): string {
  return TAB_ALIASES[tabId] ?? tabId;
}

/** Maps record anchors used across the page to the tab that renders them. */
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
  if (
    anchor.startsWith('timeline-') ||
    anchor === 'incident-activity' ||
    anchor === 'incident-alerts'
  )
    return 'timeline';
  if (anchor.startsWith('runbook-')) return opts.hasRunbooks ? 'automation' : null;
  if (anchor === 'response-activity') return 'timeline';
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
  switch (canonicalTab(tabId)) {
    case 'notes':
    case 'timeline':
      return true;
    case 'automation':
      return Boolean(options.hasAutomation || options.hasRunbooks);
    case 'postmortem':
      return Boolean(options.hasPostmortem);
    default:
      return false;
  }
}

const TRIGGER_CLASS =
  'shrink-0 flex items-center justify-center gap-1.5 py-1.5 px-2.5 text-xs font-medium rounded-md text-muted-foreground hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-2xs transition-colors select-none focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

type TimelineView = 'events' | 'response' | 'alerts' | 'audit';

/** Phone section bar: icon over label so five equal segments fit a 390px screen without scrolling. */
const SECTION_TRIGGER_CLASS =
  'flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1.5 text-2xs font-medium text-muted-foreground transition-colors data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-2xs focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

export default function IncidentDetailTabs({
  defaultTab = 'notes',
  noteCount,
  activityContent,
  timelineContent,
  automationContent,
  responseContent,
  alertsContent,
  auditContent,
  runbooksContent,
  postmortemContent,
  showPostmortem = true,
  postmortemStatus,
  className,
  layout = 'card',
  overviewContent,
  detailsContent,
}: IncidentDetailTabsProps) {
  const sections = layout === 'sections';
  const hasAutomation = !!automationContent;
  const hasRunbooks = !!runbooksContent;
  const hasResponse = !!responseContent;
  const hasPostmortem = !!postmortemContent && showPostmortem && !sections;
  const home = sections ? 'overview' : 'notes';
  // On phones Overview and Details are sections of their own; elsewhere "overview" still means Notes.
  const canon = React.useCallback(
    (t: string) => (sections && (t === 'overview' || t === 'details') ? t : canonicalTab(t)),
    [sections]
  );

  const isAvailable = React.useCallback(
    (t: string) =>
      (sections && (t === 'overview' || t === 'details')) ||
      isIncidentTabAvailable(t, { hasAutomation, hasResponse, hasRunbooks, hasPostmortem }),
    [sections, hasAutomation, hasResponse, hasRunbooks, hasPostmortem]
  );

  const fromUrl = (fallback: string) => {
    const p = new URLSearchParams(window.location.search).get('tab');
    return p && isAvailable(p) ? canon(p) : fallback;
  };

  const [tab, setTab] = useState(() => {
    const initial = defaultTab && isAvailable(defaultTab) ? canon(defaultTab) : home;
    return typeof window !== 'undefined' ? fromUrl(initial) : initial;
  });
  // Sections stay mounted once opened, so a half-written note or a loaded audit page survives switching.
  const [visited, setVisited] = useState<string[]>([]);
  if (!visited.includes(tab)) setVisited([...visited, tab]);
  const [timelineView, setTimelineView] = useState<TimelineView>(() => {
    if (typeof window === 'undefined') return 'events';
    const p = new URLSearchParams(window.location.search).get('tab');
    return p === 'response' || window.location.hash === '#response-activity'
      ? 'response'
      : 'events';
  });

  if (!isAvailable(tab) && tab !== home) {
    setTab(home);
  }

  useEffect(() => {
    const handlePopState = () => setTab(fromUrl(home));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
    // fromUrl only reads isAvailable and canon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAvailable, home]);

  useEffect(() => {
    const sync = () => {
      const anchor = decodeURIComponent(window.location.hash.slice(1));
      const target = tabForAnchor(anchor, { hasRunbooks, hasAutomation });
      if (!target || !isAvailable(target)) return;
      setTab(target);
      if (anchor === 'response-activity') setTimelineView('response');
      else if (anchor === 'incident-alerts') setTimelineView('alerts');
      else if (anchor.startsWith('timeline-') || anchor === 'incident-activity')
        setTimelineView('events');
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
    setTab(canon(nextTab));
    const params = new URLSearchParams(window.location.search);
    if (canon(nextTab) === home) params.delete('tab');
    else params.set('tab', canon(nextTab));
    const query = params.toString();
    window.history.replaceState(
      null,
      '',
      query ? `${window.location.pathname}?${query}` : window.location.pathname
    );
  };

  const views = (
    [
      { id: 'events', label: 'Events', Icon: ListTree },
      ...(hasResponse ? [{ id: 'response', label: 'Response path', Icon: Route }] : []),
      ...(alertsContent ? [{ id: 'alerts', label: 'Alerts', Icon: Bell }] : []),
      ...(auditContent ? [{ id: 'audit', label: 'Audit', Icon: ScrollText }] : []),
    ] as Array<{ id: TimelineView; label: string; Icon: typeof ListTree }>
  ).map(view => ({
    ...view,
    title:
      view.id === 'events'
        ? 'Every event, note and page, with the activity graph'
        : view.id === 'alerts'
          ? 'Every alert deduplicated into this incident, with its payload'
          : view.id === 'audit'
            ? 'Who changed what: people, automation, Squire and API/MCP clients'
            : 'How the incident was routed, paged, remediated and recovered',
  }));
  const currentView = views.find(view => view.id === timelineView) ?? views[0];
  const viewSwitcher =
    views.length > 1 ? (
      <div id="incident-alerts" className="mb-3">
        {/* Narrow screens: one picker instead of a row that runs off the edge. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Timeline view: ${currentView.label}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground shadow-2xs sm:hidden"
            >
              <currentView.Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {currentView.label}
              <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuRadioGroup
              value={timelineView}
              onValueChange={value => setTimelineView(value as TimelineView)}
            >
              {views.map(({ id, label, Icon, title }) => (
                <DropdownMenuRadioItem key={id} value={id} className="items-start gap-2 py-2">
                  <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                  <span>
                    <span className="block text-xs font-medium">{label}</span>
                    <span className="block text-2xs text-muted-foreground">{title}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <div
          role="group"
          aria-label="Timeline view"
          className="hidden rounded-lg border border-border/70 bg-muted/40 p-0.5 text-xs font-medium sm:inline-flex"
        >
          {views.map(({ id, label, Icon, title }) => (
            <button
              key={id}
              type="button"
              aria-pressed={timelineView === id}
              onClick={() => setTimelineView(id)}
              title={title}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 transition-colors',
                timelineView === id
                  ? 'bg-background text-foreground shadow-2xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden />
              {label}
            </button>
          ))}
        </div>
      </div>
    ) : null;

  const timelineBody = (
    <>
      {viewSwitcher}
      {hasResponse && timelineView === 'response'
        ? responseContent
        : alertsContent && timelineView === 'alerts'
          ? alertsContent
          : auditContent && timelineView === 'audit'
            ? auditContent
            : timelineContent}
    </>
  );

  if (sections) {
    const panel = (value: string, body: ReactNode, inCard = true) =>
      visited.includes(value) ? (
        <TabsContent
          value={value}
          forceMount
          hidden={tab !== value}
          className="mt-0 focus-visible:outline-hidden"
        >
          {inCard ? (
            <div className="rounded-xl border border-border bg-card p-3.5 text-card-foreground">
              {body}
            </div>
          ) : (
            body
          )}
        </TabsContent>
      ) : null;
    return (
      <Tabs
        value={tab}
        onValueChange={handleTabChange}
        className={cn('w-full space-y-3', className)}
      >
        <div className="sticky top-0 z-20 -mx-1 rounded-xl border border-border bg-card/95 p-1 shadow-2xs backdrop-blur-sm">
          <TabsList
            className={cn(
              'grid h-auto w-full gap-1 bg-transparent p-0',
              hasAutomation || hasRunbooks ? 'grid-cols-5' : 'grid-cols-4'
            )}
          >
            <TabsTrigger
              value="overview"
              data-incident-tab="overview"
              className={SECTION_TRIGGER_CLASS}
            >
              <LayoutList className="h-4 w-4" aria-hidden />
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="timeline"
              data-incident-tab="timeline"
              className={SECTION_TRIGGER_CLASS}
            >
              <History className="h-4 w-4" aria-hidden />
              Timeline
            </TabsTrigger>
            <TabsTrigger
              value="notes"
              data-incident-tab="notes"
              aria-label={noteCount ? `Notes (${noteCount})` : 'Notes'}
              className={SECTION_TRIGGER_CLASS}
            >
              <span className="relative">
                <MessageSquareText className="h-4 w-4" aria-hidden />
                {typeof noteCount === 'number' && noteCount > 0 && (
                  <span className="absolute -right-2.5 -top-1.5 rounded-full bg-muted-foreground/15 px-1 text-2xs font-semibold leading-none py-0.5 tabular-nums">
                    {noteCount}
                  </span>
                )}
              </span>
              Notes
            </TabsTrigger>
            {(hasAutomation || hasRunbooks) && (
              <TabsTrigger
                value="automation"
                data-incident-tab="automation"
                className={SECTION_TRIGGER_CLASS}
              >
                <Workflow className="h-4 w-4" aria-hidden />
                {hasRunbooks ? 'Runbooks' : 'Automation'}
              </TabsTrigger>
            )}
            <TabsTrigger
              value="details"
              data-incident-tab="details"
              className={SECTION_TRIGGER_CLASS}
            >
              <SlidersHorizontal className="h-4 w-4" aria-hidden />
              Details
            </TabsTrigger>
          </TabsList>
        </div>
        {panel('overview', <div className="space-y-3">{overviewContent}</div>, false)}
        {panel('timeline', timelineBody)}
        {panel('notes', <div className="space-y-6">{activityContent}</div>)}
        {(hasAutomation || hasRunbooks) &&
          panel(
            'automation',
            <div className="space-y-6">
              {runbooksContent}
              {automationContent}
            </div>
          )}
        {panel('details', <div className="space-y-3">{detailsContent}</div>, false)}
      </Tabs>
    );
  }

  return (
    <Tabs value={tab} onValueChange={handleTabChange} className={cn('w-full', className)}>
      <div className="rounded-xl border border-border bg-card shadow-2xs text-card-foreground">
        {/* Stays in view while a long timeline or notes list scrolls under it. */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 rounded-t-xl border-b border-border/70 bg-muted/40 p-1.5 backdrop-blur-sm sm:px-3 sm:py-2">
          <div className="scrollbar-none min-w-0 max-w-full flex-1 overflow-x-auto">
            <TabsList className="inline-flex h-9 w-max min-w-full items-center justify-start gap-1 rounded-lg border border-border/50 bg-muted/60 p-1 sm:h-8 sm:w-auto dark:bg-muted/30">
              <TabsTrigger value="notes" data-incident-tab="notes" className={TRIGGER_CLASS}>
                <MessageSquareText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>Notes</span>
                {typeof noteCount === 'number' && noteCount > 0 && (
                  <span className="rounded-full bg-muted-foreground/15 px-1.5 text-2xs font-semibold tabular-nums text-muted-foreground">
                    {noteCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="timeline" data-incident-tab="timeline" className={TRIGGER_CLASS}>
                <History className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>Timeline</span>
              </TabsTrigger>
              {(hasAutomation || hasRunbooks) && (
                <TabsTrigger
                  value="automation"
                  data-incident-tab="automation"
                  className={TRIGGER_CLASS}
                >
                  <Workflow className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{hasRunbooks ? 'Runbooks & automation' : 'Automation'}</span>
                </TabsTrigger>
              )}
              {hasPostmortem && (
                <TabsTrigger
                  value="postmortem"
                  data-incident-tab="postmortem"
                  className={TRIGGER_CLASS}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>Postmortem</span>
                  {postmortemStatus && (
                    <span
                      className={cn(
                        'inline-block h-1.5 w-1.5 shrink-0 rounded-full',
                        postmortemStatus === 'PUBLISHED' ? 'bg-status-ok' : 'bg-status-elevated'
                      )}
                      title={`Status: ${postmortemStatus}`}
                    />
                  )}
                </TabsTrigger>
              )}
            </TabsList>
          </div>
          {!hasPostmortem && postmortemContent && (
            <span
              className="hidden shrink-0 items-center gap-1 text-2xs text-muted-foreground lg:inline-flex"
              title="The postmortem opens once the incident is resolved; notes and events recorded now feed its first draft."
            >
              <FileText className="h-3 w-3" aria-hidden />
              Postmortem after resolve
            </span>
          )}
        </div>

        <div className="p-4 sm:p-5">
          <TabsContent value="notes" className="mt-0 space-y-6 focus-visible:outline-hidden">
            {activityContent}
          </TabsContent>

          <TabsContent value="timeline" className="mt-0 focus-visible:outline-hidden">
            {timelineBody}
          </TabsContent>

          {(hasAutomation || hasRunbooks) && (
            <TabsContent value="automation" className="mt-0 space-y-6 focus-visible:outline-hidden">
              {runbooksContent}
              {automationContent}
            </TabsContent>
          )}

          {hasPostmortem && (
            <TabsContent value="postmortem" className="mt-0 focus-visible:outline-hidden">
              {postmortemContent}
            </TabsContent>
          )}
        </div>
      </div>
    </Tabs>
  );
}
