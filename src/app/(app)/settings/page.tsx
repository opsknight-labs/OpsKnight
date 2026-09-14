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
    <div className="space-y-6 pb-12 w-full">
      {/* Compact Overview Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="flex items-center gap-3 p-3.5 rounded-xl border border-border/70 bg-card shadow-xs">
          <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0">
            <Puzzle className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">Integrations</p>
            <p className="text-sm font-semibold text-foreground truncate">
              {activeIntegrationsCount} Active
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3.5 rounded-xl border border-border/70 bg-card shadow-xs">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 shrink-0">
            <KeyRound className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">API Keys</p>
            <p className="text-sm font-semibold text-foreground truncate">
              {activeApiKeysCount} Active
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3.5 rounded-xl border border-border/70 bg-card shadow-xs">
          <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shrink-0">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">Custom Fields</p>
            <p className="text-sm font-semibold text-foreground truncate">
              {customFieldsCount} Defined
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 p-3.5 rounded-xl border border-border/70 bg-card shadow-xs">
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 shrink-0">
            <Globe className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-medium text-muted-foreground">Status Page</p>
            <p className="text-sm font-semibold text-foreground truncate">
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
              <div className="flex items-center gap-2.5 px-1">
                <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                  <SectionIcon className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-foreground tracking-tight">
                    {section.label}
                  </h2>
                  {section.description && (
                    <p className="text-xs text-muted-foreground">{section.description}</p>
                  )}
                </div>
              </div>

              {/* Grouped Rows Container */}
              <div className="rounded-xl border border-border/70 bg-card overflow-hidden divide-y divide-border/50 shadow-xs">
                {visibleItems.map(item => {
                  const ItemIcon = itemIcons[item.id] || Settings;
                  const status = itemStatuses[item.id];

                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className="group flex items-center justify-between p-3.5 sm:px-4 hover:bg-accent/40 transition-colors"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="p-2 rounded-lg bg-muted text-muted-foreground group-hover:text-primary group-hover:bg-primary/10 transition-colors shrink-0">
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
                                className="text-[10px] font-semibold px-1.5 py-0 h-4 border-border text-muted-foreground"
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
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" />
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
