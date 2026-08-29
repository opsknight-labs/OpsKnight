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
    <section aria-labelledby="coverage-explorer-title" className="space-y-3">
      <div>
        <h2 id="coverage-explorer-title" className="text-lg font-semibold">
          Coverage explorer
        </h2>
        <p className="text-sm text-muted-foreground">
          Inspect the final effective schedule or drill into configured layers.
        </p>
      </div>
      <Tabs defaultValue="timeline" className="space-y-3">
        <TabsList>
          <TabsTrigger value="timeline" className="gap-2">
            <GanttChart className="h-4 w-4" /> 7 / 14 days
          </TabsTrigger>
          <TabsTrigger value="calendar" className="gap-2">
            <CalendarDays className="h-4 w-4" /> Month
          </TabsTrigger>
        </TabsList>
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
