import { getUserPermissions } from '@/lib/rbac';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { cn } from '@/lib/utils';
import { SETTINGS_NAV_SECTIONS } from '@/components/settings/navConfig';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  User,
  Settings,
  Shield,
  Building2,
  Puzzle,
  Bell,
  ChevronRight,
  Globe,
  Activity,
  MessageSquare,
  KeyRound,
  SlidersHorizontal,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import { SlackLogo, JiraLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';

const sectionIcons: Record<string, LucideIcon | React.ComponentType<{ className?: string }>> = {
  account: User,
  workspace: Building2,
  integrations: Puzzle,
  system: Settings,
};

const itemIcons: Record<string, LucideIcon | React.ComponentType<{ className?: string }>> = {
  profile: User,
  security: Shield,
  'custom-fields': SlidersHorizontal,
  'incident-sla': Activity,
  'status-page': Globe,
  'api-keys': KeyRound,
  'audit-logs': Activity,
  'security-compliance': ShieldCheck,
  integrations: Puzzle,
  slack: SlackLogo,
  'microsoft-teams': MicrosoftTeamsLogo,
  chatops: MessageSquare,
  jira: JiraLogo,
  'health-center': Activity,
  system: Settings,
  'notifications-admin': Bell,
  'notification-operations': Activity,
  'notification-history': Bell,
};

type ItemLiveStatus = {
  label: string;
  connected: boolean;
};

const itemThemes: Record<string, { bg: string; text: string }> = {
  profile: { bg: 'bg-sky-500/10 dark:bg-sky-500/20', text: 'text-sky-600 dark:text-sky-400' },
  security: {
    bg: 'bg-emerald-500/10 dark:bg-emerald-500/20',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  'incident-sla': {
    bg: 'bg-rose-500/10 dark:bg-rose-500/20',
    text: 'text-rose-600 dark:text-rose-400',
  },
  'custom-fields': {
    bg: 'bg-indigo-500/10 dark:bg-indigo-500/20',
    text: 'text-indigo-600 dark:text-indigo-400',
  },
  'status-page': {
    bg: 'bg-cyan-500/10 dark:bg-cyan-500/20',
    text: 'text-cyan-600 dark:text-cyan-400',
  },
  'api-keys': {
    bg: 'bg-amber-500/10 dark:bg-amber-500/20',
    text: 'text-amber-600 dark:text-amber-400',
  },
  'audit-logs': {
    bg: 'bg-slate-500/10 dark:bg-slate-500/20',
    text: 'text-slate-600 dark:text-slate-400',
  },
  'security-compliance': {
    bg: 'bg-teal-500/10 dark:bg-teal-500/20',
    text: 'text-teal-600 dark:text-teal-400',
  },
  integrations: {
    bg: 'bg-purple-500/10 dark:bg-purple-500/20',
    text: 'text-purple-600 dark:text-purple-400',
  },
  slack: { bg: 'bg-[#4A154B]/10 dark:bg-[#4A154B]/20', text: 'text-[#ECB22E]' },
  'microsoft-teams': { bg: 'bg-[#505AC9]/10 dark:bg-[#505AC9]/20', text: 'text-[#7B83EB]' },
  chatops: { bg: 'bg-emerald-500/10 dark:bg-emerald-500/20', text: 'text-emerald-500' },
  jira: { bg: 'bg-[#0052CC]/10 dark:bg-[#0052CC]/20', text: 'text-[#2684FF]' },
  system: { bg: 'bg-violet-500/10 dark:bg-violet-500/20', text: 'text-violet-500' },
  'notifications-admin': { bg: 'bg-orange-500/10 dark:bg-orange-500/20', text: 'text-orange-500' },
  'health-center': { bg: 'bg-emerald-500/10 dark:bg-emerald-500/20', text: 'text-emerald-500' },
};

export default async function SettingsOverviewPage() {
  const permissions = await getUserPermissions();

  const [
    slackIntegration,
    jiraConfig,
    chatOpsConfig,
    teamsConfig,
    activeApiKeysCount,
    notificationProvidersCount,
    statusPage,
    customFieldsCount,
  ] = await Promise.all([
    prisma.slackIntegration
      .findFirst({
        where: { services: { none: {} }, enabled: true },
        select: { workspaceName: true, enabled: true },
      })
      .catch(() => null),
    prisma.jiraConfig
      .findUnique({
        where: { id: 'default' },
        select: { enabled: true, baseUrl: true },
      })
      .catch(() => null),
    prisma.chatOpsConfig
      .findUnique({
        where: { id: 'default' },
        select: { enabled: true },
      })
      .catch(() => null),
    prisma.microsoftTeamsConfig
      .findFirst({
        select: { enabled: true },
      })
      .catch(() => null),
    prisma.apiKey
      .count({
        where: { revokedAt: null },
      })
      .catch(() => 0),
    prisma.notificationProvider
      .count({
        where: { enabled: true },
      })
      .catch(() => 0),
    prisma.statusPage
      .findFirst({
        select: { enabled: true, privacyMode: true },
      })
      .catch(() => null),
    prisma.customField.count().catch(() => 0),
  ]);

  const itemStatuses: Record<string, ItemLiveStatus> = {
    slack: slackIntegration?.enabled
      ? {
          label: slackIntegration.workspaceName
            ? `Connected (${slackIntegration.workspaceName})`
            : 'Connected',
          connected: true,
        }
      : { label: 'Not Connected', connected: false },
    jira: jiraConfig?.enabled
      ? { label: 'Connected', connected: true }
      : { label: 'Not Connected', connected: false },
    'microsoft-teams': teamsConfig?.enabled
      ? { label: 'Connected', connected: true }
      : { label: 'Not Connected', connected: false },
    chatops: chatOpsConfig?.enabled
      ? { label: 'Active', connected: true }
      : { label: 'Disabled', connected: false },
    'status-page': statusPage?.enabled
      ? {
          label: statusPage.privacyMode === 'PUBLIC' ? 'Public' : 'Active',
          connected: true,
        }
      : { label: 'Disabled', connected: false },
    'api-keys': {
      label: activeApiKeysCount > 0 ? `${activeApiKeysCount} Active` : '0 Active',
      connected: activeApiKeysCount > 0,
    },
    'notifications-admin': {
      label:
        notificationProvidersCount > 0 ? `${notificationProvidersCount} Active` : 'Default Only',
      connected: notificationProvidersCount > 0,
    },
    'custom-fields': {
      label: customFieldsCount > 0 ? `${customFieldsCount} Defined` : 'None',
      connected: customFieldsCount > 0,
    },
  };

  const activeIntegrationsCount =
    (slackIntegration?.enabled ? 1 : 0) +
    (jiraConfig?.enabled ? 1 : 0) +
    (chatOpsConfig?.enabled ? 1 : 0) +
    (teamsConfig?.enabled ? 1 : 0);

  const canAccess = (item: {
    requiresAdmin?: boolean;
    requiresAdminOrAuditor?: boolean;
    requiresResponder?: boolean;
  }) => {
    if (item.requiresAdmin && !permissions.isAdmin) return false;
    if (item.requiresAdminOrAuditor && !permissions.isAdmin && !permissions.isAuditor) return false;
    if (item.requiresResponder && !permissions.isResponderOrAbove) return false;
    return true;
  };

  const sectionGroups = SETTINGS_NAV_SECTIONS.filter(section => section.id !== 'overview');

  return (
    <div className="space-y-8 pb-12 w-full">
      {/* Modern Metric Capsules */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="flex items-center gap-3.5 p-4 rounded-xl border border-border/70 bg-card shadow-xs hover:border-primary/40 hover:shadow-sm transition-all group">
          <div className="p-2.5 rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400 group-hover:scale-105 transition-transform shrink-0">
            <Puzzle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Integrations
            </p>
            <p className="text-sm font-bold text-foreground truncate mt-0.5">
              {activeIntegrationsCount} Active
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3.5 p-4 rounded-xl border border-border/70 bg-card shadow-xs hover:border-emerald-500/40 hover:shadow-sm transition-all group">
          <div className="p-2.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 group-hover:scale-105 transition-transform shrink-0">
            <KeyRound className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              API Keys
            </p>
            <p className="text-sm font-bold text-foreground truncate mt-0.5">
              {activeApiKeysCount} Active
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3.5 p-4 rounded-xl border border-border/70 bg-card shadow-xs hover:border-indigo-500/40 hover:shadow-sm transition-all group">
          <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 group-hover:scale-105 transition-transform shrink-0">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Custom Fields
            </p>
            <p className="text-sm font-bold text-foreground truncate mt-0.5">
              {customFieldsCount} Defined
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3.5 p-4 rounded-xl border border-border/70 bg-card shadow-xs hover:border-cyan-500/40 hover:shadow-sm transition-all group">
          <div className="p-2.5 rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 group-hover:scale-105 transition-transform shrink-0">
            <Globe className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
              Status Page
            </p>
            <p className="text-sm font-bold text-foreground truncate mt-0.5">
              {statusPage?.enabled
                ? statusPage.privacyMode === 'PUBLIC'
                  ? 'Public'
                  : 'Active'
                : 'Disabled'}
            </p>
          </div>
        </div>
      </div>

      {/* Settings Sections (Linear / Stripe Grouped List Style) */}
      <div className="space-y-8">
        {sectionGroups.map(section => {
          const visibleItems = section.items.filter(canAccess);
          if (visibleItems.length === 0) return null;

          const SectionIcon = sectionIcons[section.id] || Settings;

          return (
            <div key={section.id} className="space-y-3">
              {/* Section Header */}
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-1.5 rounded-lg bg-muted text-foreground/80 border border-border/40 shrink-0">
                    <SectionIcon className="h-4 w-4" />
                  </div>
                  <div className="flex flex-wrap items-baseline gap-x-2 min-w-0">
                    <span className="text-sm font-bold text-foreground tracking-tight">
                      {section.label}
                    </span>
                    {section.description && (
                      <span className="text-xs text-muted-foreground truncate">
                        — {section.description}
                      </span>
                    )}
                  </div>
                </div>
                <span className="text-[11px] font-medium text-muted-foreground/70 bg-muted/50 px-2 py-0.5 rounded-full border border-border/40 shrink-0 ml-2">
                  {visibleItems.length} {visibleItems.length === 1 ? 'item' : 'items'}
                </span>
              </div>

              {/* Grouped Rows Container */}
              <div className="rounded-xl border border-border/70 bg-card overflow-hidden divide-y divide-border/50 shadow-xs">
                {visibleItems.map(item => {
                  const ItemIcon = itemIcons[item.id] || Settings;
                  const status = itemStatuses[item.id];
                  const theme = itemThemes[item.id] || {
                    bg: 'bg-muted text-muted-foreground',
                    text: 'text-muted-foreground',
                  };

                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className="group flex items-center justify-between p-3.5 sm:px-4 hover:bg-muted/40 transition-colors duration-150"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div
                          className={cn(
                            'p-2.5 rounded-xl shrink-0 transition-transform duration-150 group-hover:scale-105',
                            theme.bg,
                            theme.text
                          )}
                        >
                          <ItemIcon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                              {item.label}
                            </span>
                            {item.badge && (
                              <Badge
                                variant="outline"
                                className="text-[10px] font-semibold px-1.5 py-0 h-4 border-border/70 text-muted-foreground bg-muted/40"
                              >
                                {item.badge}
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {item.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 ml-4">
                        {status && (
                          <Badge
                            variant="outline"
                            className={cn(
                              'text-[11px] font-medium px-2.5 py-0.5 h-6 flex items-center gap-1.5 rounded-full border',
                              status.connected
                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'border-border/60 bg-muted/40 text-muted-foreground'
                            )}
                          >
                            <span
                              className={cn(
                                'h-1.5 w-1.5 rounded-full shrink-0',
                                status.connected
                                  ? 'bg-emerald-500 animate-pulse'
                                  : 'bg-muted-foreground/50'
                              )}
                            />
                            <span className="truncate max-w-[140px]">{status.label}</span>
                          </Badge>
                        )}
                        <ChevronRight className="h-4 w-4 text-muted-foreground/60 group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
