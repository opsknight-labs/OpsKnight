'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutGrid,
  User,
  Building2,
  Puzzle,
  Settings,
  Search,
  KeyRound,
  SlidersHorizontal,
  Globe,
  ShieldCheck,
  ClipboardList,
  MessageSquare,
  Activity,
  Bell,
  Sliders,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SlackLogo, JiraLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { CommandPalette } from '@/components/settings/layout/CommandPalette';

type Props = {
  isAdmin?: boolean;
  isAuditor?: boolean;
  isResponderOrAbove?: boolean;
};

type SubItem = {
  id: string;
  label: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  requiresAdmin?: boolean;
  requiresAdminOrAuditor?: boolean;
  requiresResponder?: boolean;
  badge?: string;
};

type DomainTab = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  primaryHref: string;
  matchPrefixes: string[];
  requiresAdmin?: boolean;
  items: SubItem[];
};

const DOMAIN_TABS: DomainTab[] = [
  {
    id: 'overview',
    label: 'Overview',
    icon: LayoutGrid,
    primaryHref: '/settings',
    matchPrefixes: ['/settings'],
    items: [],
  },
  {
    id: 'account',
    label: 'Account',
    icon: User,
    primaryHref: '/settings/profile',
    matchPrefixes: ['/settings/profile', '/settings/security'],
    items: [
      { id: 'profile', label: 'Profile & Preferences', href: '/settings/profile', icon: User },
      {
        id: 'security',
        label: 'Security & Sessions',
        href: '/settings/security',
        icon: ShieldCheck,
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    icon: Building2,
    primaryHref: '/settings/incident-sla',
    matchPrefixes: [
      '/settings/incident-sla',
      '/settings/custom-fields',
      '/settings/status-pages',
      '/settings/status-page',
      '/settings/api-keys',
      '/settings/security-compliance',
    ],
    items: [
      {
        id: 'incident-sla',
        label: 'Incident SLA Policy',
        href: '/settings/incident-sla',
        icon: Activity,
        requiresAdmin: true,
      },
      {
        id: 'custom-fields',
        label: 'Custom Fields',
        href: '/settings/custom-fields',
        icon: SlidersHorizontal,
        requiresAdmin: true,
      },
      {
        id: 'status-page',
        label: 'Public Status Page',
        href: '/settings/status-pages',
        icon: Globe,
        requiresAdmin: true,
      },
      {
        id: 'api-keys',
        label: 'API Keys & Tokens',
        href: '/settings/api-keys',
        icon: KeyRound,
      },
      {
        id: 'security-compliance',
        label: 'Security & Compliance',
        href: '/settings/security-compliance',
        icon: ShieldCheck,
        requiresAdmin: true,
      },
      {
        id: 'audit-logs',
        label: 'Audit Log Stream',
        href: '/audit',
        icon: ClipboardList,
        requiresAdmin: true,
      },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    icon: Puzzle,
    primaryHref: '/settings/integrations/slack',
    matchPrefixes: ['/settings/integrations', '/settings/slack-oauth'],
    requiresAdmin: true,
    items: [
      {
        id: 'slack',
        label: 'Slack Workspace',
        href: '/settings/integrations/slack',
        icon: SlackLogo,
        requiresAdmin: true,
      },
      {
        id: 'microsoft-teams',
        label: 'Microsoft Teams',
        href: '/settings/integrations/microsoft-teams',
        icon: MicrosoftTeamsLogo,
        requiresAdmin: true,
      },
      {
        id: 'chatops',
        label: 'ChatOps War-Rooms',
        href: '/settings/integrations/chatops',
        icon: MessageSquare,
        requiresAdmin: true,
      },
      {
        id: 'jira',
        label: 'Jira Issue Tracking',
        href: '/settings/integrations/jira',
        icon: JiraLogo,
        requiresAdmin: true,
      },
    ],
  },
  {
    id: 'system',
    label: 'Platform',
    icon: Sliders,
    primaryHref: '/settings/system',
    matchPrefixes: ['/settings/system', '/settings/notifications'],
    requiresAdmin: true,
    items: [
      {
        id: 'system',
        label: 'Platform Settings',
        href: '/settings/system',
        icon: Settings,
        requiresAdmin: true,
      },
      {
        id: 'health-center',
        label: 'Health Center',
        href: '/settings/system/health',
        icon: Activity,
        requiresAdmin: true,
      },
      {
        id: 'notifications-admin',
        label: 'Notification Providers',
        href: '/settings/notifications',
        icon: Bell,
        requiresAdmin: true,
      },
      {
        id: 'notification-operations',
        label: 'Delivery Operations',
        href: '/settings/notifications/operations',
        icon: Activity,
        requiresAdminOrAuditor: true,
      },
      {
        id: 'notification-history',
        label: 'Delivery Logs',
        href: '/settings/notifications/history',
        icon: Bell,
      },
    ],
  },
];

export default function SettingsTopNav({
  isAdmin = false,
  isAuditor = false,
  isResponderOrAbove = false,
}: Props) {
  const pathname = usePathname();

  const canAccess = (item: {
    requiresAdmin?: boolean;
    requiresAdminOrAuditor?: boolean;
    requiresResponder?: boolean;
  }) => {
    if (item.requiresAdmin && !isAdmin) return false;
    if (item.requiresAdminOrAuditor && !isAdmin && !isAuditor) return false;
    if (item.requiresResponder && !isResponderOrAbove) return false;
    return true;
  };

  // Determine active domain
  const activeDomain =
    DOMAIN_TABS.find(domain => {
      if (domain.id === 'overview') {
        return pathname === '/settings';
      }
      return domain.matchPrefixes.some(
        prefix => pathname === prefix || pathname.startsWith(`${prefix}/`)
      );
    }) || (pathname.startsWith('/settings') ? DOMAIN_TABS[0] : null);

  const visibleDomains = DOMAIN_TABS.filter(domain => {
    if (domain.requiresAdmin && !isAdmin) return false;
    return true;
  });

  const visibleSubItems =
    activeDomain && activeDomain.items ? activeDomain.items.filter(canAccess) : [];

  return (
    <div className="space-y-3 mb-6">
      {/* Top Domain Bar */}
      <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-3 flex-wrap">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 p-1 bg-muted/40 rounded-xl border border-border/50">
          {visibleDomains.map(domain => {
            const isActive = activeDomain?.id === domain.id;
            const Icon = domain.icon;

            return (
              <Link
                key={domain.id}
                href={domain.primaryHref}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all select-none',
                  isActive
                    ? 'bg-background text-foreground shadow-xs font-semibold ring-1 ring-border/80'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/40'
                )}
              >
                <Icon
                  className={cn(
                    'h-3.5 w-3.5 transition-colors',
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  )}
                />
                <span>{domain.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Quick Search Button */}
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
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-border/60 bg-card hover:bg-accent/60 text-xs text-muted-foreground hover:text-foreground transition-all shadow-2xs"
            title="Search settings (⌘K)"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Search Settings...</span>
            <kbd className="pointer-events-none hidden sm:inline-flex h-4 select-none items-center gap-1 rounded border border-border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
              ⌘K
            </kbd>
          </button>
        </div>
      </div>

      {/* Secondary Contextual Sub-Pills (Shown when inside a domain) */}
      {visibleSubItems.length > 0 && activeDomain?.id !== 'overview' && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {visibleSubItems.map(item => {
            const isSubActive =
              pathname === item.href ||
              (item.href !== '/settings' && pathname.startsWith(`${item.href}/`));
            const SubIcon = item.icon;

            return (
              <Link
                key={item.id}
                href={item.href}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all shrink-0',
                  isSubActive
                    ? 'bg-primary/10 text-primary border border-primary/30 font-semibold shadow-2xs'
                    : 'border border-border/50 bg-background/60 text-muted-foreground hover:text-foreground hover:border-border'
                )}
              >
                {SubIcon && (
                  <SubIcon
                    className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      isSubActive ? 'text-primary' : 'text-muted-foreground'
                    )}
                  />
                )}
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Embedded Command Palette */}
      <CommandPalette />
    </div>
  );
}
