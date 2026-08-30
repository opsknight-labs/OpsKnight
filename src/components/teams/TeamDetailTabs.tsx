'use client';

import { type ReactNode } from 'react';
import DetailTabs, { DetailTabContent } from '@/components/ui/DetailTabs';
import { LayoutDashboard, Users, Shield, Activity, Settings2 } from 'lucide-react';

export type TeamDetailTab = 'overview' | 'members' | 'services' | 'activity' | 'settings';

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
  const tabItems = [
    {
      id: 'overview',
      label: 'Overview',
      icon: <LayoutDashboard className="h-3.5 w-3.5" />,
    },
    {
      id: 'members',
      label: 'Members',
      icon: <Users className="h-3.5 w-3.5" />,
      count: memberCount > 0 ? memberCount : undefined,
    },
    {
      id: 'services',
      label: 'Services',
      icon: <Shield className="h-3.5 w-3.5" />,
      count: serviceCount > 0 ? serviceCount : undefined,
    },
    {
      id: 'activity',
      label: 'Activity',
      icon: <Activity className="h-3.5 w-3.5" />,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: <Settings2 className="h-3.5 w-3.5" />,
    },
  ];

  return (
    <DetailTabs tabs={tabItems} defaultTab={defaultTab}>
      <DetailTabContent value="overview" className="mt-0 space-y-6">
        {overview}
      </DetailTabContent>
      <DetailTabContent value="members" className="mt-0 space-y-6">
        {members}
      </DetailTabContent>
      <DetailTabContent value="services" className="mt-0 space-y-6">
        {services}
      </DetailTabContent>
      <DetailTabContent value="activity" className="mt-0 space-y-6">
        {activity}
      </DetailTabContent>
      <DetailTabContent value="settings" className="mt-0 space-y-6">
        {settings}
      </DetailTabContent>
    </DetailTabs>
  );
}
