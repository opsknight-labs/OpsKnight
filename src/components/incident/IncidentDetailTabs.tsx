'use client';

import React, { type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { Badge } from '@/components/ui/shadcn/badge';
import { Settings2, History, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

export type IncidentDetailTabsProps = {
  defaultTab?: string;
  eventCount: number;
  noteCount?: number;
  activityContent: ReactNode;
  timelineContent: ReactNode;
  className?: string;
};

export default function IncidentDetailTabs({
  defaultTab = 'overview',
  eventCount,
  activityContent,
  timelineContent,
  className,
}: IncidentDetailTabsProps) {
  return (
    <Tabs defaultValue={defaultTab} className={cn('w-full', className)}>
      <div className="rounded-xl border border-slate-200/80 bg-white shadow-2xs overflow-hidden dark:bg-slate-900 dark:border-slate-800 transition-all">
        {/* Compact, Unified Header Bar */}
        <div className="px-3 sm:px-4 py-2 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between gap-3">
          <TabsList className="h-8 p-0.5 bg-slate-200/60 dark:bg-slate-800/80 border border-slate-200/50 dark:border-slate-700/50 rounded-lg">
            <TabsTrigger
              value="overview"
              className="gap-2 px-3 py-1 text-xs font-medium data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-2xs dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-slate-100 rounded-md transition-all"
            >
              <Settings2 className="h-4 w-4" />
              <span>Overview</span>
            </TabsTrigger>
            <TabsTrigger
              value="timeline"
              className="gap-2 px-3 py-1 text-xs font-medium data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-2xs dark:data-[state=active]:bg-slate-700 dark:data-[state=active]:text-slate-100 rounded-md transition-all"
            >
              <History className="h-4 w-4" />
              <span>Timeline</span>
            </TabsTrigger>
          </TabsList>

          <Badge
            variant="outline"
            className="gap-1.5 py-1 px-2 border-slate-300 bg-white dark:bg-slate-800 dark:border-slate-700 shrink-0 text-xs font-medium"
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
        </div>
      </div>
    </Tabs>
  );
}
