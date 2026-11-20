'use client';

import React, { useState, useMemo, useEffect, useTransition, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import DetailTabs from '@/components/ui/DetailTabs';
import { Key, Bot, Code2, Activity } from 'lucide-react';

import {
  WORKSPACE_TABS,
  type WorkspaceTabId,
  normalizeWorkspaceTab,
} from '@/lib/api-keys-workspace';

export { WORKSPACE_TABS, type WorkspaceTabId, normalizeWorkspaceTab };

export interface ApiKeysWorkspaceTabsProps {
  initialTab?: WorkspaceTabId;
  totalKeys: number;
  totalServiceAccounts: number;
  endpointCount: number;
  isAdmin: boolean;
  apiKeysContent: ReactNode;
  serviceAccountsContent: ReactNode;
  explorerContent: ReactNode;
  activityContent: ReactNode;
}

export default function ApiKeysWorkspaceTabs({
  initialTab = 'api-keys',
  totalKeys,
  totalServiceAccounts,
  endpointCount,
  isAdmin,
  apiKeysContent,
  serviceAccountsContent,
  explorerContent,
  activityContent,
}: ApiKeysWorkspaceTabsProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Resolve external tab from URL query params
  const externalTab = useMemo<WorkspaceTabId>(() => {
    const raw = searchParams?.get('tab');
    return normalizeWorkspaceTab(raw) ?? initialTab;
  }, [searchParams, initialTab]);

  const [activeTab, setActiveTab] = useState<WorkspaceTabId>(externalTab);
  const [prevExternalTab, setPrevExternalTab] = useState<WorkspaceTabId>(externalTab);

  // Synchronize during render when external searchParams change (React official recommended pattern)
  if (prevExternalTab !== externalTab) {
    setPrevExternalTab(externalTab);
    setActiveTab(externalTab);
  }

  // Synchronize on browser history popstate (back/forward buttons)
  useEffect(() => {
    const handlePopState = () => {
      if (typeof window !== 'undefined') {
        const urlParams = new URLSearchParams(window.location.search);
        const normalized = normalizeWorkspaceTab(urlParams.get('tab'));
        if (normalized) {
          setActiveTab(normalized);
        } else {
          setActiveTab(initialTab);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [initialTab]);

  const handleTabChange = (nextTab: string) => {
    if (!(WORKSPACE_TABS as readonly string[]).includes(nextTab)) return;
    const targetTab = nextTab as WorkspaceTabId;

    startTransition(() => {
      setActiveTab(targetTab);
    });

    // Shallowly synchronize URL bar without triggering blocking RSC roundtrip
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (targetTab === 'api-keys') {
        params.delete('tab');
      } else {
        params.set('tab', targetTab);
      }
      const qs = params.toString();
      const newUrl = qs ? `${pathname}?${qs}` : pathname;
      window.history.replaceState(null, '', newUrl);

      // Dispatch settings navigation event for any listeners
      window.dispatchEvent(
        new CustomEvent('opsknight:settings-navigation', {
          cancelable: true,
          detail: { parameter: 'tab', value: targetTab },
        })
      );
    }
  };

  return (
    <DetailTabs
      label="API workspace"
      layout="auto"
      syncWithUrl={false}
      activeTab={activeTab}
      onTabChange={handleTabChange}
      contentClassName="space-y-4"
      tabs={[
        {
          id: 'api-keys',
          label: `API Keys (${totalKeys})`,
          icon: <Key />,
          content: apiKeysContent,
        },
        {
          id: 'service-accounts',
          label: isAdmin ? `Service Accounts (${totalServiceAccounts})` : 'Service Accounts',
          icon: <Bot />,
          content: serviceAccountsContent,
        },
        {
          id: 'explorer',
          label: `API Explorer (${endpointCount})`,
          icon: <Code2 />,
          content: explorerContent,
        },
        { id: 'activity', label: 'API Activity', icon: <Activity />, content: activityContent },
      ]}
    />
  );
}
