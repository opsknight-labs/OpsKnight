'use client';

import React, { type ReactNode } from 'react';
import DetailTabs, { DetailTabContent } from '@/components/ui/DetailTabs';
import { Flame, ShieldAlert, Zap, Settings } from 'lucide-react';

export type ServiceDetailTab = 'incidents' | 'escalation' | 'integrations' | 'settings';

export type ServiceDetailTabsProps = {
  defaultTab?: string;
  activeIncidentCount: number;
  integrationCount: number;
  incidentsContent: ReactNode;
  escalationContent: ReactNode;
  integrationsContent: ReactNode;
  settingsContent: ReactNode;
  actions?: ReactNode;
};

export default function ServiceDetailTabs({
  defaultTab = 'incidents',
  activeIncidentCount,
  integrationCount,
  incidentsContent,
  escalationContent,
  integrationsContent,
  settingsContent,
  actions,
}: ServiceDetailTabsProps) {
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
      id: 'integrations',
      label: 'Integrations & Webhooks',
      icon: <Zap className="h-4 w-4" />,
      count: integrationCount,
    },
    {
      id: 'settings',
      label: 'Service Settings',
      icon: <Settings className="h-4 w-4" />,
    },
  ];

  return (
    <DetailTabs tabs={tabItems} defaultTab={defaultTab} actions={actions} className="space-y-6">
      <DetailTabContent value="incidents" className="mt-0 space-y-6">
        {incidentsContent}
      </DetailTabContent>
      <DetailTabContent value="escalation" className="mt-0 space-y-6">
        {escalationContent}
      </DetailTabContent>
      <DetailTabContent value="integrations" className="mt-0 space-y-6">
        {integrationsContent}
      </DetailTabContent>
      <DetailTabContent value="settings" className="mt-0 space-y-6">
        {settingsContent}
      </DetailTabContent>
    </DetailTabs>
  );
}
