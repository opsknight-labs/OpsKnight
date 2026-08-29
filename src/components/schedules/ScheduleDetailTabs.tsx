'use client';

import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { CalendarClock, Layers3, Settings2, ShieldPlus } from 'lucide-react';

type ScheduleDetailTab = 'overview' | 'rotation' | 'overrides' | 'settings';

type ScheduleDetailTabsProps = {
  defaultTab?: string;
  overview: ReactNode;
  rotation: ReactNode;
  overrides: ReactNode;
  settings: ReactNode;
};

function normalizeTab(tab?: string): ScheduleDetailTab {
  return tab === 'rotation' || tab === 'overrides' || tab === 'settings' ? tab : 'overview';
}

export default function ScheduleDetailTabs({
  defaultTab,
  overview,
  rotation,
  overrides,
  settings,
}: ScheduleDetailTabsProps) {
  return (
    <Tabs defaultValue={normalizeTab(defaultTab)} className="space-y-5">
      <div className="overflow-x-auto pb-1">
        <TabsList className="grid h-auto min-w-[520px] grid-cols-4 bg-muted/60 p-1">
          <TabsTrigger value="overview" className="gap-2 py-2.5">
            <CalendarClock className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="rotation" className="gap-2 py-2.5">
            <Layers3 className="h-4 w-4" />
            Rotation
          </TabsTrigger>
          <TabsTrigger value="overrides" className="gap-2 py-2.5">
            <ShieldPlus className="h-4 w-4" />
            Overrides
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2 py-2.5">
            <Settings2 className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="overview" className="mt-0 space-y-5">
        {overview}
      </TabsContent>
      <TabsContent value="rotation" className="mt-0 space-y-5">
        {rotation}
      </TabsContent>
      <TabsContent value="overrides" className="mt-0 space-y-5">
        {overrides}
      </TabsContent>
      <TabsContent value="settings" className="mt-0 space-y-5">
        {settings}
      </TabsContent>
    </Tabs>
  );
}
