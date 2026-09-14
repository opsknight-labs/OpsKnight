'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  User,
  ShieldCheck,
  Activity,
  SlidersHorizontal,
  Globe,
  KeyRound,
  Puzzle,
  Settings,
  ClipboardList,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { CommandPalette } from '@/components/settings/layout/CommandPalette';

type Props = {
  isAdmin?: boolean;
  isAuditor?: boolean;
  isResponderOrAbove?: boolean;
};

export type SettingsTab = {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon | React.ComponentType<{ className?: string }>;
  matchPrefixes: string[];
  requiresAdmin?: boolean;
  requiresAuditor?: boolean;
  requiresResponder?: boolean;
};

export const SETTINGS_TABS: SettingsTab[] = [
  {
    id: 'overview',
    label: 'Overview',
    href: '/settings',
    icon: LayoutGrid,
    matchPrefixes: ['/settings'],
  },
  {
    id: 'profile',
    label: 'Profile',
    href: '/settings/profile',
    icon: User,
    matchPrefixes: ['/settings/profile'],
  },
  {
    id: 'security',
    label: 'Security & Access',
    href: '/settings/security',
    icon: ShieldCheck,
    matchPrefixes: ['/settings/security'],
  },
  {
    id: 'incident-sla',
    label: 'Incident SLAs',
    href: '/settings/incident-sla',
    icon: Activity,
    matchPrefixes: ['/settings/incident-sla'],
    requiresAdmin: true,
  },
  {
    id: 'custom-fields',
    label: 'Custom Fields',
    href: '/settings/custom-fields',
    icon: SlidersHorizontal,
    matchPrefixes: ['/settings/custom-fields'],
    requiresAdmin: true,
  },
  {
    id: 'status-pages',
    label: 'Status Pages',
    href: '/settings/status-pages',
    icon: Globe,
    matchPrefixes: ['/settings/status-pages', '/settings/status-page'],
    requiresAdmin: true,
  },
  {
    id: 'api-keys',
    label: 'API Keys',
    href: '/settings/api-keys',
    icon: KeyRound,
    matchPrefixes: ['/settings/api-keys'],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    href: '/settings/integrations/slack',
    icon: Puzzle,
    matchPrefixes: ['/settings/integrations', '/settings/slack-oauth'],
    requiresAdmin: true,
  },
  {
    id: 'platform',
    label: 'Platform',
    href: '/settings/system',
    icon: Settings,
    matchPrefixes: ['/settings/system', '/settings/notifications'],
    requiresAdmin: true,
  },
  {
    id: 'audit',
    label: 'Audit Logs',
    href: '/audit',
    icon: ClipboardList,
    matchPrefixes: ['/audit'],
    requiresAdmin: true,
  },
];

export default function SettingsTopNav({
  isAdmin = false,
  isAuditor = false,
  isResponderOrAbove = false,
}: Props) {
  const pathname = usePathname();

  const canAccess = (tab: SettingsTab) => {
    if (tab.requiresAdmin && !isAdmin) return false;
    if (tab.requiresAuditor && !isAdmin && !isAuditor) return false;
    if (tab.requiresResponder && !isResponderOrAbove) return false;
    return true;
  };

  const visibleTabs = SETTINGS_TABS.filter(canAccess);

  // Determine active tab
  const activeTab =
    visibleTabs.find(tab => {
      if (tab.id === 'overview') {
        return pathname === '/settings';
      }
      return tab.matchPrefixes.some(
        prefix =>
          prefix !== '/settings' && (pathname === prefix || pathname.startsWith(`${prefix}/`))
      );
    }) || (pathname.startsWith('/settings') ? visibleTabs[0] : null);

  return (
    <div className="space-y-4">
      {/* Unified Settings Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your personal account, workspace configuration, integrations, and platform
            operations.
          </p>
        </div>

        {/* Quick Search Button (⌘K) */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const event = new KeyboardEvent('keydown', {
                key: 'k',
                metaKey: true,
                bubbles: true,
              });
              document.dispatchEvent(event);
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border/70 bg-card hover:bg-accent/60 text-xs text-muted-foreground hover:text-foreground transition-all shadow-xs"
            title="Search settings (⌘K)"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search Settings...</span>
            <kbd className="pointer-events-none ml-1 inline-flex h-4 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
          </button>
        </div>
      </div>

      {/* Clean Single-Tier Tab Bar (Vercel / GitHub Repos style) */}
      <nav
        className="flex items-center gap-1 overflow-x-auto border-b border-border/60 pb-px scrollbar-none"
        aria-label="Settings Navigation"
      >
        {visibleTabs.map(tab => {
          const isActive = activeTab?.id === tab.id;
          const Icon = tab.icon;

          return (
            <Link
              key={tab.id}
              href={tab.href}
              className={cn(
                '-mb-px flex items-center gap-2 border-b-2 px-3.5 pb-2.5 pt-1.5 text-xs sm:text-sm font-medium whitespace-nowrap transition-all select-none',
                isActive
                  ? 'border-primary text-foreground font-semibold'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border/70'
              )}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0 transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              />
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Embedded Command Palette */}
      <CommandPalette />
    </div>
  );
}
