'use client';

import { useMemo, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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

function normalizeTab(tab?: string | null): ScheduleDetailTab {
  return tab === 'rotation' || tab === 'overrides' || tab === 'settings' ? tab : 'overview';
}

export default function ScheduleDetailTabs({
  defaultTab,
  overview,
  rotation,
  overrides,
  settings,
}: ScheduleDetailTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const activeTab = useMemo(() => {
    const urlTab = searchParams.get('tab');
    if (urlTab) return normalizeTab(urlTab);
    return normalizeTab(defaultTab);
  }, [searchParams, defaultTab]);

  const handleTabChange = (value: string) => {
    const nextTab = normalizeTab(value);
    const params = new URLSearchParams(searchParams.toString());
    if (nextTab === 'overview') {
      params.delete('tab');
    } else {
      params.set('tab', nextTab);
    }
    const queryString = params.toString();
    const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
    startTransition(() => {
      router.push(newUrl, { scroll: false });
    });
  };

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
      <div className="overflow-x-auto pb-1">
        <TabsList className="grid h-auto min-w-[520px] grid-cols-4 rounded-xl border bg-card/90 p-1.5 shadow-sm">
          <TabsTrigger
            value="overview"
            className="gap-2 rounded-lg py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          >
            <CalendarClock className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="rotation"
            className="gap-2 rounded-lg py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          >
            <Layers3 className="h-4 w-4" />
            Rotation
          </TabsTrigger>
          <TabsTrigger
            value="overrides"
            className="gap-2 rounded-lg py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          >
            <ShieldPlus className="h-4 w-4" />
            Overrides
          </TabsTrigger>
          <TabsTrigger
            value="settings"
            className="gap-2 rounded-lg py-2.5 text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-sm"
          >
            <Settings2 className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="overview" className="mt-0 space-y-6">
        {overview}
      </TabsContent>
      <TabsContent value="rotation" className="mt-0 space-y-6">
        {rotation}
      </TabsContent>
      <TabsContent value="overrides" className="mt-0 space-y-6">
        {overrides}
      </TabsContent>
      <TabsContent value="settings" className="mt-0 space-y-6">
        {settings}
      </TabsContent>
    </Tabs>
  );
}
