'use client';

import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/shadcn/card';
import { CalendarDays, GanttChart } from 'lucide-react';

export default function ScheduleCoverageExplorer({
  timeline,
  calendar,
  exportMenu,
}: {
  timeline: ReactNode;
  calendar: ReactNode;
  exportMenu?: ReactNode;
}) {
  return (
    <Card
      className="overflow-hidden border-border/70 shadow-sm"
      aria-labelledby="coverage-explorer-title"
    >
      <Tabs defaultValue="timeline" className="w-full">
        <CardHeader className="border-b bg-muted/20 px-4 py-3 sm:px-6">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <GanttChart className="h-4 w-4" />
              </div>
              <div>
                <CardTitle
                  id="coverage-explorer-title"
                  className="text-sm sm:text-base font-semibold"
                >
                  Coverage explorer
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground">
                  Inspect rotation layers, handoffs, and effective on-call coverage.
                </CardDescription>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start sm:self-center flex-wrap">
              <TabsList className="grid h-8.5 grid-cols-2 bg-muted/80 p-0.5">
                <TabsTrigger value="timeline" className="gap-1.5 text-xs font-medium px-3 py-1">
                  <GanttChart className="h-3.5 w-3.5" /> Timeline
                </TabsTrigger>
                <TabsTrigger value="calendar" className="gap-1.5 text-xs font-medium px-3 py-1">
                  <CalendarDays className="h-3.5 w-3.5" /> Calendar
                </TabsTrigger>
              </TabsList>

              {exportMenu}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <TabsContent value="timeline" className="mt-0 focus-visible:outline-none">
            {timeline}
          </TabsContent>
          <TabsContent value="calendar" className="mt-0 focus-visible:outline-none">
            {calendar}
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}
