import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import NotificationHistory from '@/components/settings/NotificationHistory';

export default async function NotificationHistoryPage() {
  const permissions = await getUserPermissions();

  if (!permissions) {
    redirect('/login');
  }

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Notification History & Delivery Logs"
        description="Track delivery status, dispatch timestamps, and channel response codes across all outbound notification attempts."
        backHref="/settings"
        backLabel="Back to Settings"
      />

      <SettingsSection
        title="Delivery Status Stream"
        description="Monitor outbound notifications and troubleshoot channel delivery issues."
      >
        <NotificationHistory />
      </SettingsSection>
    </div>
  );
}
