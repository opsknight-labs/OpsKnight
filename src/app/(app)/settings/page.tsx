import { getUserPermissions } from '@/lib/rbac';
import Link from 'next/link';
import prisma from '@/lib/prisma';
import { SETTINGS_NAV_SECTIONS } from '@/components/settings/navConfig';
import {
  User,
  Settings,
  Shield,
  Puzzle,
  Bell,
  ChevronRight,
  Globe,
  Activity,
  MessageSquare,
  KeyRound,
  SlidersHorizontal,
  ShieldCheck,
  Terminal,
  Bot,
  Users,
  Target,
  FileLock2,
  HeartPulse,
  History,
  type LucideIcon,
} from 'lucide-react';
import { SlackLogo, JiraLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { PageHeader } from '@/components/patterns';
import SettingsSearchTrigger from '@/components/settings/SettingsSearchTrigger';
import { settingsSectionHref } from '@/components/settings/settings-breadcrumbs';
import { IntegrationStatusBadge } from '@/components/settings/integrations/IntegrationStatus';
import {
  loadIntegrationStates,
  type IntegrationStatus,
} from '@/components/settings/integrations/load-integration-states';
import { requirePageAccess } from '@/lib/access/server';
import { canAccessPath } from '@/lib/access/pages';

const itemIcons = new Map<string, LucideIcon | React.ComponentType<{ className?: string }>>([
  ['profile', User],
  ['security', Shield],
  ['my-access', KeyRound],
  ['access-requests', Users],
  ['access-admin', ShieldCheck],
  ['custom-fields', SlidersHorizontal],
  ['incident-sla', Activity],
  ['service-objectives', Target],
  ['status-page', Globe],
  ['api-keys', KeyRound],
  ['audit-logs', History],
  ['security-compliance', ShieldCheck],
  ['privacy-requests', FileLock2],
  ['slack', SlackLogo],
  ['microsoft-teams', MicrosoftTeamsLogo],
  ['chatops', MessageSquare],
  ['mcp', Bot],
  ['jira', JiraLogo],
  ['health-center', HeartPulse],
  ['system', Settings],
  ['system-logs', Terminal],
  ['notifications-admin', Bell],
  ['notification-operations', Activity],
  ['notification-history', Bell],
]);

const notConnected: IntegrationStatus = { state: 'not_connected', label: 'Not connected' };
const unavailable: IntegrationStatus = { state: 'error', label: "Couldn't check" };

export default async function SettingsOverviewPage() {
  await requirePageAccess('/settings');
  const permissions = await getUserPermissions();

  const now = new Date();
  const apiKeysQuery =
    permissions.authenticated && permissions.id
      ? prisma.apiKey.count({
          where: {
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            ...(permissions.isAdmin ? {} : { userId: permissions.id }),
          },
        })
      : Promise.resolve(0);

  const [
    integrationsResult,
    apiKeysResult,
    notificationProvidersResult,
    statusPageResult,
    customFieldsResult,
  ] = await Promise.allSettled([
    permissions.isAdmin ? loadIntegrationStates() : Promise.resolve(null),
    apiKeysQuery,
    permissions.isAdmin
      ? prisma.notificationProvider.count({ where: { enabled: true } })
      : Promise.resolve(0),
    permissions.isAdmin
      ? prisma.statusPage.findFirst({ select: { enabled: true, privacyMode: true } })
      : Promise.resolve(null),
    permissions.isAdmin ? prisma.customField.count() : Promise.resolve(0),
  ]);

  const integrations = integrationsResult.status === 'fulfilled' ? integrationsResult.value : null;
  const apiKeysFailed = apiKeysResult.status === 'rejected';
  const activeApiKeysCount = apiKeysResult.status === 'fulfilled' ? apiKeysResult.value : 0;
  const notifFailed = notificationProvidersResult.status === 'rejected';
  const notificationProvidersCount =
    notificationProvidersResult.status === 'fulfilled' ? notificationProvidersResult.value : 0;
  const statusPageFailed = statusPageResult.status === 'rejected';
  const statusPage = statusPageResult.status === 'fulfilled' ? statusPageResult.value : null;
  const customFieldsFailed = customFieldsResult.status === 'rejected';
  const customFieldsCount =
    customFieldsResult.status === 'fulfilled' ? customFieldsResult.value : 0;

  const integrationStatus = (status: IntegrationStatus | undefined) =>
    integrationsResult.status === 'rejected' ? unavailable : (status ?? notConnected);

  const itemStatuses = new Map<string, IntegrationStatus>(
    permissions.isAdmin
      ? [
          ['slack', integrationStatus(integrations?.slack)],
          ['microsoft-teams', integrationStatus(integrations?.['microsoft-teams'])],
          ['chatops', integrationStatus(integrations?.chatops)],
          ['jira', integrationStatus(integrations?.jira)],
          [
            'status-page',
            statusPageFailed
              ? unavailable
              : statusPage?.enabled
                ? {
                    state: 'connected',
                    label: statusPage.privacyMode === 'PUBLIC' ? 'Public' : 'Published',
                  }
                : { state: 'not_connected', label: 'Off' },
          ],
          [
            'notifications-admin',
            notifFailed
              ? unavailable
              : notificationProvidersCount > 0
                ? { state: 'connected', label: `${notificationProvidersCount} active` }
                : { state: 'not_connected', label: 'Defaults only' },
          ],
          [
            'custom-fields',
            customFieldsFailed
              ? unavailable
              : customFieldsCount > 0
                ? { state: 'connected', label: `${customFieldsCount} defined` }
                : { state: 'not_connected', label: 'None' },
          ],
          [
            'api-keys',
            apiKeysFailed
              ? unavailable
              : activeApiKeysCount > 0
                ? { state: 'connected', label: `${activeApiKeysCount} active` }
                : { state: 'not_connected', label: 'None active' },
          ],
        ]
      : []
  );

  const connectedIntegrations = integrations
    ? Object.values(integrations).filter(s => s.state === 'connected').length
    : 0;

  const canAccess = (item: { href: string }) => canAccessPath(item.href, permissions.capabilities);
  const sectionGroups = SETTINGS_NAV_SECTIONS.filter(section => section.id !== 'overview');

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Workspace Configuration"
        title="Settings"
        icon={Settings}
        description="Your account, workspace configuration, integrations and platform operations."
        primaryAction={<SettingsSearchTrigger tone="inverse" />}
        stats={
          permissions.isAdmin
            ? [
                {
                  label: 'Integrations',
                  value:
                    integrationsResult.status === 'rejected'
                      ? '—'
                      : `${connectedIntegrations} connected`,
                  icon: <Puzzle className="h-3.5 w-3.5" aria-hidden="true" />,
                  href: '/settings/integrations',
                },
                {
                  label: 'API keys',
                  value: apiKeysFailed ? '—' : `${activeApiKeysCount} active`,
                  icon: <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />,
                  href: '/settings/api-keys',
                },
                {
                  label: 'Custom fields',
                  value: customFieldsFailed ? '—' : customFieldsCount,
                  icon: <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />,
                  href: '/settings/custom-fields',
                },
                {
                  label: 'Status page',
                  value: statusPageFailed ? '—' : statusPage?.enabled ? 'Published' : 'Off',
                  icon: <Globe className="h-3.5 w-3.5" aria-hidden="true" />,
                  href: '/settings/status-pages',
                },
              ]
            : undefined
        }
      />

      {sectionGroups.map(section => {
        const visibleItems = section.items.filter(canAccess);
        if (visibleItems.length === 0) return null;
        const headingId = `settings-section-${section.id}`;
        const isIntegrations = section.id === 'integrations';

        return (
          <section
            key={section.id}
            id={section.id}
            aria-labelledby={headingId}
            className="scroll-mt-24 space-y-3"
          >
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1 px-1">
              <div className="min-w-0">
                <h2 id={headingId} className="text-base font-semibold text-foreground">
                  {section.label}
                </h2>
                {section.description && (
                  <p className="text-sm text-muted-foreground">{section.description}</p>
                )}
              </div>
              {isIntegrations &&
                canAccessPath('/settings/integrations', permissions.capabilities) && (
                  <Link
                    href={settingsSectionHref(section.id)}
                    className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    All integrations
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                )}
            </div>

            <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              {visibleItems.map(item => {
                const ItemIcon = itemIcons.get(item.id) ?? Settings;
                const status = itemStatuses.get(item.id);

                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      className="group flex items-center justify-between gap-4 px-4 py-3.5 transition-colors duration-150 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-muted sm:px-5"
                    >
                      <div className="flex min-w-0 items-center gap-3.5">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
                          <ItemIcon className="h-5 w-5 shrink-0" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">
                              {item.label}
                            </span>
                            {item.badge && (
                              <span className="rounded-full border border-border px-1.5 text-2xs font-medium leading-4 text-muted-foreground">
                                {item.badge}
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 max-w-2xl truncate text-xs text-muted-foreground">
                            {item.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-3">
                        {status && (
                          <IntegrationStatusBadge
                            state={status.state}
                            label={status.label}
                            className="hidden max-w-[180px] sm:inline-flex"
                          />
                        )}
                        <ChevronRight
                          className="h-4 w-4 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-foreground motion-reduce:transition-none"
                          aria-hidden="true"
                        />
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
