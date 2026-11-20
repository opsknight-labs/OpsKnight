'use client';

import React, { type ReactNode } from 'react';
import DetailTabs from '@/components/ui/DetailTabs';
import {
  Activity,
  Globe,
  Shield,
  UserCheck,
  Database,
  Key,
  HeartPulse,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';
import { toneClasses } from '@/components/patterns/status-tone';
import { cn } from '@/lib/utils';

interface Props {
  overviewTab?: ReactNode;
  automationTab?: ReactNode;
  appUrlTab: ReactNode;
  ssoTab: ReactNode;
  scimTab?: ReactNode;
  retentionTab: ReactNode;
  envTab: ReactNode;
  ssoEnabled: boolean;
  scimEnabled?: boolean;
  appUrlConfigured: boolean;
  allEnvOk: boolean;
  missingCount: number;
}

export default function SystemSettingsTabs({
  overviewTab,
  automationTab,
  appUrlTab,
  ssoTab,
  scimTab,
  retentionTab,
  envTab,
  ssoEnabled,
  scimEnabled,
  appUrlConfigured,
  allEnvOk,
  missingCount,
}: Props) {
  const tabs = [
    ...(overviewTab
      ? [
          {
            id: 'overview',
            label: 'Overview',
            icon: <Activity className="h-3.5 w-3.5" />,
            badge: (
              <span
                className={cn(
                  'rounded-full border px-1.5 py-0.5 text-2xs font-semibold',
                  toneClasses('ok').soft
                )}
              >
                Live
              </span>
            ),
            content: overviewTab,
          },
        ]
      : []),
    ...(automationTab
      ? [
          {
            id: 'automation',
            label: 'Automation',
            icon: <Shield className="h-3.5 w-3.5" />,
            content: automationTab,
          },
        ]
      : []),
    {
      id: 'app-url',
      label: 'App URL',
      icon: <Globe className="h-3.5 w-3.5" />,
      badge: !appUrlConfigured ? (
        <span
          className={cn(
            'rounded-full border px-1.5 py-0.5 text-2xs font-semibold',
            toneClasses('elevated').soft
          )}
        >
          Fallback
        </span>
      ) : undefined,
      content: appUrlTab,
    },
    {
      id: 'sso',
      label: 'SSO / Authentication',
      icon: <Shield className="h-3.5 w-3.5" />,
      badge: ssoEnabled ? (
        <span
          className={cn(
            'rounded-full border px-1.5 py-0.5 text-2xs font-semibold',
            toneClasses('ok').soft
          )}
        >
          Enabled
        </span>
      ) : undefined,
      content: ssoTab,
    },
    ...(scimTab
      ? [
          {
            id: 'scim',
            label: 'SCIM Provisioning',
            icon: <UserCheck className="h-3.5 w-3.5" />,
            badge: scimEnabled ? (
              <span
                className={cn(
                  'rounded-full border px-1.5 py-0.5 text-2xs font-semibold',
                  toneClasses('ok').soft
                )}
              >
                Active
              </span>
            ) : (
              <span
                className={cn(
                  'rounded-full border px-1.5 py-0.5 text-2xs font-semibold',
                  toneClasses(null).soft
                )}
              >
                SCIM 2.0
              </span>
            ),
            content: scimTab,
          },
        ]
      : []),
    {
      id: 'retention',
      label: 'Data Retention',
      icon: <Database className="h-3.5 w-3.5" />,
      content: retentionTab,
    },
    {
      id: 'environment',
      label: 'Environment',
      icon: <Key className="h-3.5 w-3.5" />,
      badge: !allEnvOk ? (
        <span
          className={cn(
            'rounded-full border px-1.5 py-0.5 text-2xs font-semibold',
            toneClasses('critical').soft
          )}
        >
          {missingCount} missing
        </span>
      ) : undefined,
      content: envTab,
    },
  ];

  return (
    <DetailTabs
      tabs={tabs}
      defaultTab={overviewTab ? 'overview' : 'app-url'}
      urlParamName="section"
      layout="auto"
      actions={
        <Button asChild size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
          <Link href="/settings/system/health">
            <HeartPulse className="h-3.5 w-3.5" aria-hidden="true" />
            Health Center
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </Button>
      }
    />
  );
}
