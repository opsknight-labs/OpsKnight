import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import { JiraLogo } from '@/components/common/BrandLogos';
import { Shield, Globe, Mail, Lock, CheckCircle2, XCircle } from 'lucide-react';
import JiraIntegrationPage from '@/components/settings/JiraIntegrationPage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function GlobalJiraIntegrationPage() {
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
  if (config?.baseUrl) {
    try {
      siteHostname = new URL(config.baseUrl).hostname;
    } catch {
      siteHostname = config.baseUrl;
    }
  }

  const isConnected = Boolean(config?.baseUrl && config?.userEmail && config?.enabled);

  return (
    <div className="space-y-6">
      <DetailHeroBanner
        breadcrumb={{ label: 'Settings', href: '/settings', current: 'Jira Integration' }}
        tag="ATLASSIAN WORKSPACE INTEGRATION"
        title="Jira Integration"
        subtitle="Connect Atlassian Jira Cloud or Data Center to turn incidents and postmortem action items into tracked engineering issues."
        badges={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className="border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground text-[10px] font-semibold"
            >
              <Shield className="h-3 w-3 mr-1" />
              Admin Only
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] font-semibold ${
                isConnected
                  ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-100'
                  : 'border-white/20 bg-white/10 text-primary-foreground/80'
              }`}
            >
              {isConnected ? (
                <>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Connected & Active
                </>
              ) : (
                <>
                  <XCircle className="h-3 w-3 mr-1" />
                  {config?.baseUrl ? 'Disabled' : 'Not Configured'}
                </>
              )}
            </Badge>
          </div>
        }
        statsPlacement="bottom"
        stats={[
          {
            label: 'Jira Site',
            value: siteHostname,
            icon: <JiraLogo className="h-4 w-4" />,
            valueClassName: config?.baseUrl
              ? 'text-primary-foreground font-mono text-xs'
              : 'text-primary-foreground/70',
            subtext: config?.baseUrl ? 'Atlassian Cloud' : 'Site URL needed',
          },
          {
            label: 'Service Account',
            value: config?.userEmail ?? 'None',
            icon: <Mail className="h-4 w-4" />,
            valueClassName: config?.userEmail
              ? 'text-primary-foreground text-xs font-mono'
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

      <JiraIntegrationPage config={config} isAdmin={permissions.isAdmin} />
    </div>
  );
}
