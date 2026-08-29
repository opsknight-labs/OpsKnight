'use client';

import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { CalendarDays, GanttChart } from 'lucide-react';

export default function ScheduleCoverageExplorer({
  timeline,
  calendar,
}: {
  timeline: ReactNode;
  calendar: ReactNode;
}) {
  return (
    <section
      aria-labelledby="coverage-explorer-title"
      className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm md:p-5"
    >
      <Tabs defaultValue="timeline" className="space-y-4">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Planning view
            </p>
            <h2 id="coverage-explorer-title" className="mt-1 text-xl font-semibold tracking-tight">
              Coverage explorer
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Inspect final coverage or drill into the configured rotation layers.
            </p>
          </div>
          <TabsList className="grid w-full grid-cols-2 sm:w-auto">
            <TabsTrigger value="timeline" className="gap-2">
              <GanttChart className="h-4 w-4" /> 7 / 14 days
            </TabsTrigger>
            <TabsTrigger value="calendar" className="gap-2">
              <CalendarDays className="h-4 w-4" /> Month
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="timeline" className="mt-0">
          {timeline}
        </TabsContent>
        <TabsContent value="calendar" className="mt-0">
          {calendar}
        </TabsContent>
      </Tabs>
    </section>
  );
}
