'use client';

import React, { type ReactNode } from 'react';
import DetailTabs from '@/components/ui/DetailTabs';
import { Globe, Shield, Database, Key, HeartPulse, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/shadcn/button';

interface Props {
  appUrlTab: ReactNode;
  ssoTab: ReactNode;
  retentionTab: ReactNode;
  envTab: ReactNode;
  ssoEnabled: boolean;
  appUrlConfigured: boolean;
  allEnvOk: boolean;
  missingCount: number;
}

export default function SystemSettingsTabs({
  appUrlTab,
  ssoTab,
  retentionTab,
  envTab,
  ssoEnabled,
  appUrlConfigured,
  allEnvOk,
  missingCount,
}: Props) {
  const tabs = [
    {
      id: 'app-url',
      label: 'App URL',
      icon: <Globe className="h-3.5 w-3.5" />,
      badge: !appUrlConfigured ? (
        <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-amber-600 dark:text-amber-400">
          Fallback
        </span>
      ) : undefined,
      content: appUrlTab,
    },
    {
      id: 'sso',
      label: 'SSO / OIDC',
      icon: <Shield className="h-3.5 w-3.5" />,
      badge: ssoEnabled ? (
        <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
          Enabled
        </span>
      ) : undefined,
      content: ssoTab,
    },
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
        <span className="rounded-full bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-rose-600 dark:text-rose-400">
          {missingCount} missing
        </span>
      ) : undefined,
      content: envTab,
    },
  ];

  return (
    <DetailTabs
      tabs={tabs}
      defaultTab="app-url"
      urlParamName="section"
      layout="grid"
      actions={
        <Link href="/settings/system/health">
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
            <HeartPulse className="h-3.5 w-3.5 text-emerald-500" />
            Health Center
            <ArrowRight className="h-3 w-3" />
          </Button>
        </Link>
      }
    />
  );
}
