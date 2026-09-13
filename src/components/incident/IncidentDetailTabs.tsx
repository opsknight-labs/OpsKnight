'use client';

import React, { type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { Badge } from '@/components/ui/shadcn/badge';
import { Settings2, History, Zap, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

export type IncidentDetailTabsProps = {
  defaultTab?: string;
  eventCount: number;
  noteCount?: number;
  activityContent: ReactNode;
  timelineContent: ReactNode;
  postmortemContent?: ReactNode;
  postmortemStatus?: string | null;
  className?: string;
};

export default function IncidentDetailTabs({
  defaultTab = 'overview',
  eventCount,
  activityContent,
  timelineContent,
  postmortemContent,
  postmortemStatus,
  className,
}: IncidentDetailTabsProps) {
  return (
    <Tabs defaultValue={defaultTab} className={cn('w-full', className)}>
      <div className="rounded-xl border border-border bg-card shadow-2xs overflow-hidden text-card-foreground transition-all">
        {/* Compact, Unified Header Bar */}
        <div className="px-3 sm:px-4 py-2 border-b border-border/80 bg-muted/30 flex items-center justify-between gap-3">
          <TabsList className="h-8 p-0.5 bg-muted/80 border border-border/70 rounded-lg">
            <TabsTrigger
              value="overview"
              className="gap-2 px-3 py-1 text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-2xs rounded-md transition-all"
            >
              <Settings2 className="h-4 w-4" />
              <span>Overview</span>
            </TabsTrigger>
            <TabsTrigger
              value="timeline"
              className="gap-2 px-3 py-1 text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-2xs rounded-md transition-all"
            >
              <History className="h-4 w-4" />
              <span>Timeline</span>
            </TabsTrigger>
            <TabsTrigger
              value="postmortem"
              className="gap-2 px-3 py-1 text-xs font-medium data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-2xs rounded-md transition-all"
            >
              <FileText className="h-4 w-4" />
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

          <Badge
            variant="outline"
            className="gap-1.5 py-1 px-2 border-border bg-background shrink-0 text-xs font-medium"
          >
            <Zap className="h-3.5 w-3.5 text-amber-500" />
            <span>{eventCount} Events</span>
          </Badge>
        </div>

        {/* Tab Content */}
        <div className="p-4 sm:p-5">
          <TabsContent value="overview" className="mt-0 space-y-6 focus-visible:outline-none">
            {activityContent}
          </TabsContent>

          <TabsContent value="timeline" className="mt-0 focus-visible:outline-none">
            {timelineContent}
          </TabsContent>

          <TabsContent value="postmortem" className="mt-0 focus-visible:outline-none">
            {postmortemContent}
          </TabsContent>
        </div>
      </div>
    </Tabs>
  );
}
