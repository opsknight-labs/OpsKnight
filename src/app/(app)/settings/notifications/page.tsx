import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import SystemNotificationSettings from '@/components/settings/SystemNotificationSettings';
import { getNotificationProviders } from '@/app/(app)/settings/system/actions';

export default async function NotificationProviderSettingsPage() {
  const permissions = await getUserPermissions();

  if (!permissions.isAdmin) {
    redirect('/settings');
  }
  const providers = await getNotificationProviders();

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Notification Providers"
        description="Configure SMS (Twilio/SNS), Web Push (VAPID), and WhatsApp Business outbound providers for your organization."
        backHref="/settings"
        backLabel="Back to Settings"
      />

      <SettingsSection
        title="Provider Configuration"
        description="Manage outbound API credentials and test delivery for all alert channels."
      >
        <SystemNotificationSettings providers={providers} />
      </SettingsSection>
    </div>
  );
}
