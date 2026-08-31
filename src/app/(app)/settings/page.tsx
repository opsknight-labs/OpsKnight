import { getUserPermissions } from '@/lib/rbac';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { cn } from '@/lib/utils';
import { SETTINGS_NAV_SECTIONS, SETTINGS_NAV_ITEMS } from '@/components/settings/navConfig';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/shadcn/card';
import { Badge } from '@/components/ui/shadcn/badge';
import SettingsSearch from '@/components/settings/SettingsSearch';
import {
  User,
  Settings,
  Shield,
  Building2,
  Puzzle,
  Bell,
  ArrowRight,
  Lock,
  Globe,
  Activity,
  MessageSquare,
  KeyRound,
  SlidersHorizontal,
  Tickets,
  type LucideIcon,
} from 'lucide-react';
import { SlackLogo, JiraLogo } from '@/components/common/BrandLogos';

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
  'status-page': Globe,
  'api-keys': KeyRound,
  'audit-logs': Activity,
  integrations: Puzzle,
  slack: SlackLogo,
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
  const accessibleItems = SETTINGS_NAV_ITEMS.filter(canAccess);
  const popularLinks = accessibleItems.filter(item =>
    ['profile', 'security', 'api-keys', 'notifications-admin', 'custom-fields'].includes(item.id)
  );

  return (
    <div className="space-y-8 pb-12 w-full">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Manage your personal preferences, workspace configuration, alert integrations, and system
          diagnostics in one place.
        </p>
      </div>

      {/* Search & Quick Access Section */}
      <Card className="border-border bg-card shadow-xs w-full">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg font-semibold">Search Settings</CardTitle>
          <CardDescription>Quickly jump to any setting, provider, or integration</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <SettingsSearch
            items={accessibleItems}
            placeholder="Search settings, integrations, parameters..."
          />

          {/* Quick Access Links */}
          {popularLinks.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                Quick Access
              </h3>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {popularLinks.map(item => {
                  const Icon = itemIcons[item.id] || Settings;

                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-background hover:bg-accent/60 hover:border-slate-300 hover:shadow-xs transition-all duration-150 group"
                    >
                      <div className="p-1.5 rounded-md bg-muted text-muted-foreground group-hover:text-foreground transition-colors shrink-0">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-xs text-foreground truncate">{item.label}</p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {item.description}
                        </p>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all shrink-0" />
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Settings Categories (Dynamic multi-column layout for large screens) */}
      <div className="space-y-6">
        {sectionGroups.map(section => {
          const visibleItems = section.items.filter(canAccess);
          if (visibleItems.length === 0) return null;

          const SectionIcon = sectionIcons[section.id] || Settings;

          return (
            <Card key={section.id} className="border-border bg-card shadow-xs w-full">
              <CardHeader className="pb-4 border-b border-border/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10 text-primary">
                    <SectionIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-bold">{section.label}</CardTitle>
                    {section.description && (
                      <CardDescription className="text-xs">{section.description}</CardDescription>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-5">
                <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {visibleItems.map(item => {
                    const ItemIcon = itemIcons[item.id] || Settings;
                    const status = itemStatuses[item.id];

                    return (
                      <Link
                        key={item.id}
                        href={item.href}
                        className="group relative p-4 rounded-xl border border-border bg-background hover:bg-accent/50 hover:border-primary/30 hover:shadow-xs transition-all duration-150 flex flex-col justify-between"
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2 mb-2.5">
                            <div className="p-2 rounded-lg bg-muted text-muted-foreground group-hover:text-primary transition-colors">
                              <ItemIcon className="h-4 w-4" />
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap justify-end">
                              {status && (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    'text-[10px] font-medium px-2 py-0.5 h-5 flex items-center gap-1.5 rounded-full border',
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
                                  <span className="truncate max-w-[125px]">{status.label}</span>
                                </Badge>
                              )}
                              {item.badge && (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] font-semibold px-1.5 py-0 h-4 border-border text-muted-foreground"
                                >
                                  {item.badge}
                                </Badge>
                              )}
                            </div>
                          </div>

                          <h3 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors">
                            {item.label}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
                            {item.description}
                          </p>
                        </div>

                        <div className="pt-3 mt-3 border-t border-border/40 flex items-center justify-between text-xs font-medium text-muted-foreground group-hover:text-primary transition-colors">
                          <span>Configure</span>
                          <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
