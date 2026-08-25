import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import ChatOpsSettingsPage from '@/components/settings/ChatOpsSettingsPage';

export default async function GlobalChatOpsIntegrationPage() {
  const permissions = await getUserPermissions();
  if (!permissions) redirect('/login');

  const config = await prisma.chatOpsConfig.findUnique({
    where: { id: 'default' },
  });

  const slackIntegration = await prisma.slackIntegration.findFirst({
    where: { services: { none: {} }, enabled: true },
  });

  const isSlackConnected = !!slackIntegration?.botToken;

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="ChatOps Integration"
        description="Configure automatic Slack channel creation and video war rooms for incidents."
        backHref="/settings/integrations"
        backLabel="Back to Integrations"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Integrations', href: '/settings/integrations' },
          { label: 'ChatOps', href: '/settings/integrations/chatops' },
        ]}
      />

      <ChatOpsSettingsPage
        config={config}
        isAdmin={permissions.isAdmin}
        isSlackConnected={isSlackConnected}
      />
    </div>
  );
}
