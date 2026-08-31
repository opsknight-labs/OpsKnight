import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import prisma from '@/lib/prisma';
import SlackIntegrationPage from '@/components/settings/SlackIntegrationPage';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';

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

  const isOAuthConfigured = !!(oauthConfig?.clientId && oauthConfig?.clientSecret);
  const isSigningSecretConfigured =
    !!oauthConfig?.signingSecret || !!process.env.SLACK_SIGNING_SECRET;

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Slack Integration"
        description="Connect your Slack workspace to receive incident notifications."
        backHref="/settings"
        backLabel="Back to Settings"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Slack', href: '/settings/integrations/slack' },
        ]}
      />

      <SlackIntegrationPage
        integration={globalIntegration}
        isOAuthConfigured={isOAuthConfigured}
        isSigningSecretConfigured={isSigningSecretConfigured}
        isAdmin={permissions.isAdmin}
      />
    </div>
  );
}
