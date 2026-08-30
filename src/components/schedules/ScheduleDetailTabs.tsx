'use client';

import { type ReactNode } from 'react';
import DetailTabs, { DetailTabContent } from '@/components/ui/DetailTabs';
import { CalendarClock, Layers3, Settings2, ShieldPlus } from 'lucide-react';

export type ScheduleDetailTab = 'overview' | 'rotation' | 'overrides' | 'settings';

type ScheduleDetailTabsProps = {
  defaultTab?: string;
  overview: ReactNode;
  rotation: ReactNode;
  overrides: ReactNode;
  settings: ReactNode;
};

export default function ScheduleDetailTabs({
  defaultTab,
  overview,
  rotation,
  overrides,
  settings,
}: ScheduleDetailTabsProps) {
  const tabItems = [
    {
      id: 'overview',
      label: 'Overview',
      icon: <CalendarClock className="h-4 w-4" />,
    },
    {
      id: 'rotation',
      label: 'Rotation',
      icon: <Layers3 className="h-4 w-4" />,
    },
    {
      id: 'overrides',
      label: 'Overrides',
      icon: <ShieldPlus className="h-4 w-4" />,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: <Settings2 className="h-4 w-4" />,
    },
  ];

  return (
    <DetailTabs tabs={tabItems} defaultTab={defaultTab}>
      <DetailTabContent value="overview" className="mt-0 space-y-6">
        {overview}
      </DetailTabContent>
      <DetailTabContent value="rotation" className="mt-0 space-y-6">
        {rotation}
      </DetailTabContent>
      <DetailTabContent value="overrides" className="mt-0 space-y-6">
        {overrides}
      </DetailTabContent>
      <DetailTabContent value="settings" className="mt-0 space-y-6">
        {settings}
      </DetailTabContent>
    </DetailTabs>
  );
}
