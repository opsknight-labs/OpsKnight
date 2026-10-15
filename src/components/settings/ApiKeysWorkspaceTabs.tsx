'use client';

import React, { useState, useMemo, useEffect, useTransition, type ReactNode } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/shadcn/tabs';
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
    <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
      <TabsList className="h-auto max-w-full flex-wrap justify-start bg-muted/70 p-1 border border-border/80 rounded-xl">
        <TabsTrigger
          value="api-keys"
          onClick={() => handleTabChange('api-keys')}
          className="text-xs font-semibold gap-1.5 px-3.5 cursor-pointer"
        >
          <Key className="h-3.5 w-3.5" />
          <span>API Keys ({totalKeys})</span>
        </TabsTrigger>
        <TabsTrigger
          value="service-accounts"
          onClick={() => handleTabChange('service-accounts')}
          className="text-xs font-semibold gap-1.5 px-3.5 cursor-pointer"
        >
          <Bot className="h-3.5 w-3.5" />
          <span>Service Accounts {isAdmin ? `(${totalServiceAccounts})` : ''}</span>
        </TabsTrigger>
        <TabsTrigger
          value="explorer"
          onClick={() => handleTabChange('explorer')}
          className="text-xs font-semibold gap-1.5 px-3.5 cursor-pointer"
        >
          <Code2 className="h-3.5 w-3.5" />
          <span>API Explorer ({endpointCount})</span>
        </TabsTrigger>
        <TabsTrigger
          value="activity"
          onClick={() => handleTabChange('activity')}
          className="text-xs font-semibold gap-1.5 px-3.5 cursor-pointer"
        >
          <Activity className="h-3.5 w-3.5" />
          <span>API Activity</span>
        </TabsTrigger>
      </TabsList>

      {/* Tab 1: API Keys */}
      <TabsContent value="api-keys" className="space-y-4">
        {apiKeysContent}
      </TabsContent>

      {/* Tab 2: Service Accounts */}
      <TabsContent value="service-accounts" className="space-y-4">
        {serviceAccountsContent}
      </TabsContent>

      {/* Tab 3: API Explorer */}
      <TabsContent value="explorer" className="space-y-4">
        {explorerContent}
      </TabsContent>

      {/* Tab 4: API Activity */}
      <TabsContent value="activity" className="space-y-4">
        {activityContent}
      </TabsContent>
    </Tabs>
  );
}
