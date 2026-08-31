import { redirect } from 'next/navigation';
import SettingsPage from '@/components/settings/SettingsPage';
import SettingsSectionCard from '@/components/settings/SettingsSectionCard';
import NotificationOperations from '@/components/settings/NotificationOperations';
import { getCurrentUser } from '@/lib/rbac';

export default async function NotificationOperationsPage() {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    redirect('/login');
  }

  if (user.role !== 'ADMIN' && user.role !== 'AUDITOR') {
    redirect('/settings');
  }

  return (
    <SettingsPage
      currentPageId="notification-operations"
      backHref="/settings"
      title="Notification Operations"
      description="Workspace-wide delivery health and recovery for every centralized channel."
    >
      <SettingsSectionCard
        title="Delivery control plane"
        description="Recipients are masked, provider errors are redacted, and encrypted message payloads are never exposed."
      >
        <NotificationOperations canRetry={user.role === 'ADMIN'} />
      </SettingsSectionCard>
    </SettingsPage>
  );
}
