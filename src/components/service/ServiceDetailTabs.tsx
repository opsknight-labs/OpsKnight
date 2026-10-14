'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import React, { type ReactNode } from 'react';
import DetailTabs, { DetailTabContent } from '@/components/ui/DetailTabs';
import { Flame, ShieldAlert, Zap, Bell, Settings, Workflow } from 'lucide-react';

export type ServiceDetailTab =
  | 'incidents'
  | 'escalation'
  | 'runbooks'
  | 'integrations'
  | 'notifications'
  | 'settings';

export type ServiceDetailTabsProps = {
  defaultTab?: string;
  activeIncidentCount: number;
  integrationCount: number;
  runbooksCount?: number;
  notificationsCount?: number | string;
  incidentsContent: ReactNode;
  escalationContent: ReactNode;
  runbooksContent: ReactNode;
  integrationsContent: ReactNode;
  notificationsContent: ReactNode;
  settingsContent: ReactNode;
  actions?: ReactNode;
};

export default function ServiceDetailTabs({
  defaultTab = 'incidents',
  activeIncidentCount,
  integrationCount,
  runbooksCount,
  notificationsCount,
  incidentsContent,
  escalationContent,
  runbooksContent,
  integrationsContent,
  notificationsContent,
  settingsContent,
  actions,
}: ServiceDetailTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams();
  const tabItems = [
    {
      id: 'incidents',
      label: 'Incidents',
      icon: <Flame className="h-4 w-4" />,
      count: activeIncidentCount > 0 ? `${activeIncidentCount} Active` : '0',
    },
    {
      id: 'escalation',
      label: 'Escalation Policy',
      icon: <ShieldAlert className="h-4 w-4" />,
    },
    {
      id: 'runbooks',
      label: 'Runbooks',
      icon: <Workflow className="h-4 w-4" />,
      count: runbooksCount,
    },
    {
      id: 'integrations',
      label: 'Integrations & Webhooks',
      icon: <Zap className="h-4 w-4" />,
      count: integrationCount,
    },
    {
      id: 'notifications',
      label: 'Notifications',
      icon: <Bell className="h-4 w-4" />,
      count: notificationsCount,
    },
    {
      id: 'settings',
      label: 'Service Settings',
      icon: <Settings className="h-4 w-4" />,
    },
  ];

  return (
    <DetailTabs
      tabs={tabItems}
      defaultTab={defaultTab}
      onTabChange={tab => {
        if (tab === 'runbooks') {
          const params = new URLSearchParams(query.toString());
          params.set('tab', 'runbooks');
          router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        }
      }}
      actions={actions}
      className="space-y-6"
    >
      <DetailTabContent value="incidents" className="mt-0 space-y-6">
        {incidentsContent}
      </DetailTabContent>
      <DetailTabContent value="escalation" className="mt-0 space-y-6">
        {escalationContent}
      </DetailTabContent>
      <DetailTabContent value="runbooks" className="mt-0 space-y-6">
        {runbooksContent}
      </DetailTabContent>
      <DetailTabContent value="integrations" className="mt-0 space-y-6">
        {integrationsContent}
      </DetailTabContent>
      <DetailTabContent value="notifications" className="mt-0 space-y-6">
        {notificationsContent}
      </DetailTabContent>
      <DetailTabContent value="settings" className="mt-0 space-y-6">
        {settingsContent}
      </DetailTabContent>
    </DetailTabs>
  );
}
