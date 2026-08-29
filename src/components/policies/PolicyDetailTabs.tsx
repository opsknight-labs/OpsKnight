'use client';

import { useMemo, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { Layers, Server, Activity, Settings } from 'lucide-react';
import { Badge } from '@/components/ui/shadcn/badge';

export type PolicyDetailTab = 'steps' | 'services' | 'activity' | 'settings';

type PolicyDetailTabsProps = {
  defaultTab?: string;
  stepCount: number;
  serviceCount: number;
  activityCount: number;
  steps: ReactNode;
  services: ReactNode;
  activity: ReactNode;
  settings: ReactNode;
};

function normalizeTab(tab?: string | null): PolicyDetailTab {
  return tab === 'services' || tab === 'activity' || tab === 'settings' ? tab : 'steps';
}

export default function PolicyDetailTabs({
  defaultTab,
  stepCount,
  serviceCount,
  activityCount,
  steps,
  services,
  activity,
  settings,
}: PolicyDetailTabsProps) {
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
    if (nextTab === 'steps') {
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
        <TabsList className="grid h-auto min-w-[560px] grid-cols-4 rounded-xl border bg-card/90 p-1.5 shadow-xs">
          <TabsTrigger
            value="steps"
            className="gap-2 rounded-lg py-2.5 text-xs font-medium text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-xs transition-all"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Escalation Steps</span>
            <Badge
              variant={activeTab === 'steps' ? 'outline' : 'secondary'}
              className="ml-1 text-[10px] px-1.5 py-0 h-4 border-white/30"
            >
              {stepCount}
            </Badge>
          </TabsTrigger>

          <TabsTrigger
            value="services"
            className="gap-2 rounded-lg py-2.5 text-xs font-medium text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-xs transition-all"
          >
            <Server className="h-3.5 w-3.5" />
            <span>Linked Services</span>
            <Badge
              variant={activeTab === 'services' ? 'outline' : 'secondary'}
              className="ml-1 text-[10px] px-1.5 py-0 h-4 border-white/30"
            >
              {serviceCount}
            </Badge>
          </TabsTrigger>

          <TabsTrigger
            value="activity"
            className="gap-2 rounded-lg py-2.5 text-xs font-medium text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-xs transition-all"
          >
            <Activity className="h-3.5 w-3.5" />
            <span>Activity History</span>
            {activityCount > 0 && (
              <Badge
                variant={activeTab === 'activity' ? 'outline' : 'secondary'}
                className="ml-1 text-[10px] px-1.5 py-0 h-4 border-white/30"
              >
                {activityCount}
              </Badge>
            )}
          </TabsTrigger>

          <TabsTrigger
            value="settings"
            className="gap-2 rounded-lg py-2.5 text-xs font-medium text-muted-foreground data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-xs transition-all"
          >
            <Settings className="h-3.5 w-3.5" />
            <span>Policy Settings</span>
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="steps" className="mt-0 space-y-6">
        {steps}
      </TabsContent>
      <TabsContent value="services" className="mt-0 space-y-6">
        {services}
      </TabsContent>
      <TabsContent value="activity" className="mt-0 space-y-6">
        {activity}
      </TabsContent>
      <TabsContent value="settings" className="mt-0 space-y-6">
        {settings}
      </TabsContent>
    </Tabs>
  );
}
