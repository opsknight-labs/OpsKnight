'use client';

import { type ReactNode } from 'react';
import DetailTabs, { DetailTabContent } from '@/components/ui/DetailTabs';
import { Layers, Server, Activity, Settings } from 'lucide-react';

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
  const tabItems = [
    {
      id: 'steps',
      label: 'Escalation Steps',
      icon: <Layers className="h-4 w-4" />,
      count: stepCount,
    },
    {
      id: 'services',
      label: 'Linked Services',
      icon: <Server className="h-4 w-4" />,
      count: serviceCount,
    },
    {
      id: 'activity',
      label: 'Activity History',
      icon: <Activity className="h-4 w-4" />,
      count: activityCount,
    },
    {
      id: 'settings',
      label: 'Policy Settings',
      icon: <Settings className="h-4 w-4" />,
    },
  ];

  return (
    <DetailTabs tabs={tabItems} defaultTab={defaultTab}>
      <DetailTabContent value="steps" className="mt-0 space-y-6">
        {steps}
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
