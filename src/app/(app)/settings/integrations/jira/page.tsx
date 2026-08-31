import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import JiraIntegrationPage from '@/components/settings/JiraIntegrationPage';

export default async function GlobalJiraIntegrationPage() {
  const permissions = await getUserPermissions();
  if (!permissions) redirect('/login');

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

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Jira Integration"
        description="Connect Jira to turn incidents and postmortem action items into tracked engineering work."
        backHref="/settings"
        backLabel="Back to Settings"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Jira', href: '/settings/integrations/jira' },
        ]}
      />

      <JiraIntegrationPage config={config} isAdmin={permissions.isAdmin} />
    </div>
  );
}
