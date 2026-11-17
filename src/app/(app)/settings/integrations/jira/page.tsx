import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import { ServiceIntegrationsLink } from '@/components/settings/integrations/ServiceIntegrationsLink';
import { IntegrationStatusBadge } from '@/components/settings/integrations/IntegrationStatus';
import { JiraLogo } from '@/components/common/BrandLogos';
import { Globe, Mail, Lock } from 'lucide-react';
import JiraIntegrationPage from '@/components/settings/JiraIntegrationPage';
import { getAppUrl } from '@/lib/app-url';
import { requirePageAccess } from '@/lib/access/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function GlobalJiraIntegrationPage() {
  await requirePageAccess('/settings/integrations/jira');
  const permissions = await getUserPermissions();
  if (!permissions) redirect('/login');
  if (!permissions.isAdmin) redirect('/settings');

  const config = await prisma.jiraConfig.findUnique({
    where: { id: 'default' },
    select: {
      baseUrl: true,
      userEmail: true,
      enabled: true,
      webhookSecretEncrypted: true,
      updatedAt: true,
      updatedByUser: {
        select: { name: true, email: true },
      },
    },
  });

  let siteHostname = 'Not configured';
  let siteDisplayName = 'Not configured';
  let siteSubtext = 'Site URL needed';
  if (config?.baseUrl) {
    try {
      const parsed = new URL(config.baseUrl);
      siteHostname = parsed.hostname;
      if (parsed.hostname.toLowerCase().endsWith('.atlassian.net')) {
        siteDisplayName = parsed.hostname.replace(/\.atlassian\.net$/i, '');
        siteSubtext = 'Atlassian Cloud';
      } else {
        siteDisplayName = parsed.hostname;
        siteSubtext = 'Self-hosted Jira';
      }
    } catch {
      siteHostname = config.baseUrl;
      siteDisplayName = config.baseUrl;
      siteSubtext = 'Jira Instance';
    }
  }

  const isConnected = Boolean(config?.baseUrl && config?.userEmail && config?.enabled);

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        icon={JiraLogo}
        title="Jira Integration"
        description="Connect Atlassian Jira Cloud or Data Center to turn incidents and postmortem action items into tracked engineering issues."
        badges={
          <IntegrationStatusBadge
            onDark
            state={isConnected ? 'connected' : 'not_connected'}
            label={isConnected ? 'Connected' : config?.baseUrl ? 'Turned off' : 'Not connected'}
          />
        }
        statsPlacement="bottom"
        stats={[
          {
            label: 'Jira Site',
            value: siteDisplayName,
            icon: <JiraLogo className="h-4 w-4" />,
            tooltip: siteHostname,
            valueClassName: config?.baseUrl
              ? 'text-primary-foreground font-semibold text-xs sm:text-sm font-mono truncate max-w-full'
              : 'text-primary-foreground/70',
            subtext: siteSubtext,
          },
          {
            label: 'Service Account',
            value: config?.userEmail ?? 'None',
            icon: <Mail className="h-4 w-4" />,
            tooltip: config?.userEmail ?? undefined,
            valueClassName: config?.userEmail
              ? 'text-primary-foreground text-xs font-mono truncate max-w-full'
              : 'text-primary-foreground/70',
            subtext: config?.userEmail ? 'API token auth' : 'Email required',
          },
          {
            label: 'Webhook Sync',
            value: config?.webhookSecretEncrypted ? 'Encrypted Secret' : 'Standard Webhook',
            icon: <Lock className="h-4 w-4" />,
            valueClassName: config?.webhookSecretEncrypted ? 'text-emerald-300' : 'text-amber-300',
            subtext: 'Inbound issue updates',
          },
          {
            label: 'Issue Sync',
            value: config?.enabled ? 'Active' : 'Disabled',
            icon: <Globe className="h-4 w-4" />,
            valueClassName: config?.enabled ? 'text-emerald-300' : 'text-primary-foreground/70',
            subtext: 'Incident action items',
          },
        ]}
      />

      <JiraIntegrationPage
        key={config?.updatedAt.toISOString() ?? 'jira-unconfigured'}
        config={config}
        isAdmin={permissions.isAdmin}
        appUrl={await getAppUrl()}
      />
      <ServiceIntegrationsLink description="Map each service to a Jira project and issue type on the service's Settings tab." />
    </div>
  );
}
