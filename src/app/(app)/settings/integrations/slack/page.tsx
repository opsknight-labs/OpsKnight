import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import { SlackLogo } from '@/components/common/BrandLogos';
import {
  Shield,
  ShieldCheck,
  Hash,
  Lock,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
} from 'lucide-react';
import { SLACK_REQUIRED_BOT_SCOPES } from '@/lib/slack/app-manifest';
import SlackIntegrationPage from '@/components/settings/SlackIntegrationPage';
import { getAppUrl } from '@/lib/app-url';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function GlobalSlackIntegrationPage() {
  const permissions = await getUserPermissions();

  if (!permissions) {
    redirect('/login');
  }

  if (!permissions.isAdmin) {
    redirect('/settings');
  }

  // Get global Slack integration (not tied to any service)
  const globalIntegration = await prisma.slackIntegration.findFirst({
    where: {
      services: { none: {} }, // Global integration
    },
    select: {
      id: true,
      workspaceId: true,
      workspaceName: true,
      enabled: true,
      createdAt: true,
      updatedAt: true,
      scopes: true,
      installer: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
  });

  // Check if OAuth is configured (database only - no env vars for UI-driven setup)
  const oauthConfig = await prisma.slackOAuthConfig.findFirst({
    where: { enabled: true },
    orderBy: { updatedAt: 'desc' },
  });

  const isClientIdValid =
    Boolean(oauthConfig?.clientId) &&
    !oauthConfig!.clientId.startsWith('T') &&
    !oauthConfig!.clientId.startsWith('A') &&
    oauthConfig!.clientId !== 'workspace-credentials';

  const isOAuthConfigured = Boolean(isClientIdValid && oauthConfig?.clientSecret);
  const isSigningSecretConfigured =
    !!oauthConfig?.signingSecret || !!process.env.SLACK_SIGNING_SECRET;

  const isConnected = Boolean(globalIntegration?.enabled);
  const scopeSet = new Set(globalIntegration?.scopes ?? []);
  const missingRequiredScopes = SLACK_REQUIRED_BOT_SCOPES.filter(s => !scopeSet.has(s));

  const appUrl = await getAppUrl();

  return (
    <div className="space-y-6">
      {/* Detail Hero Header */}
      <DetailHeroBanner
        breadcrumb={{ label: 'Settings', href: '/settings', current: 'Slack Integration' }}
        tag="COLLABORATION ENGINE"
        title="Slack Integration"
        subtitle="Connect your Slack workspace for incident alerts, bi-directional triage, slash commands, and video war rooms."
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
                  : isOAuthConfigured
                    ? 'border-blue-400/60 bg-blue-400/15 text-blue-100'
                    : 'border-amber-400/60 bg-amber-400/15 text-amber-100'
              }`}
            >
              {isConnected ? (
                <>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Workspace Connected
                </>
              ) : isOAuthConfigured ? (
                <>
                  <ArrowUpRight className="h-3 w-3 mr-1" />
                  Ready to Connect
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Setup Required
                </>
              )}
            </Badge>
          </div>
        }
        statsPlacement="bottom"
        stats={[
          {
            label: 'Workspace',
            value:
              globalIntegration?.workspaceName ??
              (isOAuthConfigured ? 'Not Connected' : 'Unconfigured'),
            icon: <SlackLogo className="h-4 w-4" />,
            tooltip: globalIntegration?.workspaceName ?? undefined,
            valueClassName: globalIntegration?.workspaceName
              ? 'text-primary-foreground font-semibold text-sm sm:text-base truncate'
              : 'text-primary-foreground/70',
            subtext: globalIntegration?.enabled ? 'Active integration' : 'OAuth needed',
          },
          {
            label: 'Bot Permissions',
            value: globalIntegration
              ? missingRequiredScopes.length === 0
                ? 'All 13 Granted'
                : `${missingRequiredScopes.length} Missing`
              : 'OAuth required',
            icon: <ShieldCheck className="h-4 w-4" />,
            valueClassName:
              globalIntegration && missingRequiredScopes.length === 0
                ? 'text-emerald-300 font-semibold text-sm sm:text-base'
                : 'text-amber-300 font-semibold text-sm sm:text-base',
            subtext: 'Bot token scopes',
          },
          {
            label: 'Channel Routing',
            value: globalIntegration?.enabled ? 'Available' : 'Disabled',
            icon: <Hash className="h-4 w-4" />,
            valueClassName: globalIntegration?.enabled
              ? 'text-emerald-300 font-semibold text-sm sm:text-base'
              : 'text-primary-foreground/70',
            subtext: 'Incident channels',
          },
          {
            label: 'Security & Verification',
            value: isSigningSecretConfigured ? 'HMAC Verified' : 'Secret Missing',
            icon: <Lock className="h-4 w-4" />,
            valueClassName: isSigningSecretConfigured
              ? 'text-emerald-300 font-semibold text-sm sm:text-base'
              : 'text-amber-300 font-semibold text-sm sm:text-base',
            subtext: 'Request signature',
          },
        ]}
      />

      <SlackIntegrationPage
        integration={globalIntegration}
        isOAuthConfigured={isOAuthConfigured}
        isSigningSecretConfigured={isSigningSecretConfigured}
        isAdmin={permissions.isAdmin}
        appUrl={appUrl}
      />
    </div>
  );
}
