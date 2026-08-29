'use client';

import { useMemo, useTransition, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
import { LayoutDashboard, Users, Shield, Activity, Settings2 } from 'lucide-react';

type TeamDetailTab = 'overview' | 'members' | 'services' | 'activity' | 'settings';

type TeamDetailTabsProps = {
  defaultTab?: string;
  overview: ReactNode;
  members: ReactNode;
  services: ReactNode;
  activity: ReactNode;
  settings: ReactNode;
  memberCount?: number;
  serviceCount?: number;
};

function normalizeTab(tab?: string | null): TeamDetailTab {
  return tab === 'members' || tab === 'services' || tab === 'activity' || tab === 'settings'
    ? tab
    : 'overview';
}

export default function TeamDetailTabs({
  defaultTab,
  overview,
  members,
  services,
  activity,
  settings,
  memberCount = 0,
  serviceCount = 0,
}: TeamDetailTabsProps) {
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
        <TabsList className="grid h-auto min-w-[540px] grid-cols-5 rounded-xl border bg-card/90 p-1.5 shadow-xs">
          <TabsTrigger
            value="overview"
            className="gap-2 rounded-lg py-2 text-xs text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-xs"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="members"
            className="gap-2 rounded-lg py-2 text-xs text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-xs"
          >
            <Users className="h-3.5 w-3.5" />
            Members
            {memberCount > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-semibold text-muted-foreground">
                {memberCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="services"
            className="gap-2 rounded-lg py-2 text-xs text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-xs"
          >
            <Shield className="h-3.5 w-3.5" />
            Services
            {serviceCount > 0 && (
              <span className="rounded-full bg-muted px-1.5 py-0.2 text-[10px] font-semibold text-muted-foreground">
                {serviceCount}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger
            value="activity"
            className="gap-2 rounded-lg py-2 text-xs text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-xs"
          >
            <Activity className="h-3.5 w-3.5" />
            Activity
          </TabsTrigger>
          <TabsTrigger
            value="settings"
            className="gap-2 rounded-lg py-2 text-xs text-muted-foreground data-[state=active]:text-foreground data-[state=active]:shadow-xs"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Settings
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="overview" className="mt-0 space-y-6 focus-visible:outline-none">
        {overview}
      </TabsContent>
      <TabsContent value="members" className="mt-0 space-y-6 focus-visible:outline-none">
        {members}
      </TabsContent>
      <TabsContent value="services" className="mt-0 space-y-6 focus-visible:outline-none">
        {services}
      </TabsContent>
      <TabsContent value="activity" className="mt-0 space-y-6 focus-visible:outline-none">
        {activity}
      </TabsContent>
      <TabsContent value="settings" className="mt-0 space-y-6 focus-visible:outline-none">
        {settings}
      </TabsContent>
    </Tabs>
  );
}
