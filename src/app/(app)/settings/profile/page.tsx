import prisma from '@/lib/prisma';
import { getAuthOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';
import ProfileForm from '@/components/settings/ProfileForm';
import PreferencesForm from '@/components/settings/PreferencesForm';
import NotificationPreferencesForm from '@/components/settings/NotificationPreferencesForm';
import QuietHoursForm from '@/components/settings/QuietHoursForm';
import { SettingsPageHeader } from '@/components/settings/layout/SettingsPageHeader';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';

export default async function ProfileSettingsPage() {
  const session = await getServerSession(await getAuthOptions());
  const email = session?.user?.email ?? null;

  // Fetch user data from database (combined from profile + preferences)
  const user = email
    ? await prisma.user.findUnique({
        where: { email },
        select: {
          // Profile fields
          name: true,
          role: true,
          createdAt: true,
          timeZone: true,
          department: true,
          jobTitle: true,
          avatarUrl: true,
          gender: true,
          lastOidcSync: true,
          // Preferences fields

          emailNotificationsEnabled: true,
          smsNotificationsEnabled: true,
          pushNotificationsEnabled: true,
          whatsappNotificationsEnabled: true,
          phoneNumber: true,
          quietHoursEnabled: true,
          quietHoursStartMinutes: true,
          quietHoursEndMinutes: true,
          quietHoursWeekendAllDay: true,
        },
      })
    : null;

  const name = user?.name || session?.user?.name || '';
  const role = user?.role || (session?.user as any)?.role || 'USER'; // eslint-disable-line @typescript-eslint/no-explicit-any
  const timeZone = getUserTimeZone(user ?? undefined);
  const memberSince = user?.createdAt
    ? formatDateTime(user.createdAt, timeZone, { format: 'date' })
    : 'Unknown';
  const lastOidcSync = user?.lastOidcSync
    ? formatDateTime(user.lastOidcSync, timeZone, { format: 'datetime' })
    : null;

  return (
    <div className="space-y-6">
      <SettingsPageHeader
        title="Profile & Preferences"
        description="Manage your identity and personalize your OpsKnight experience."
        backHref="/settings"
        backLabel="Back to Settings"
      />

      <SettingsSection
        title="Profile"
        description="Identity details tied to your OpsKnight account."
      >
        <ProfileForm
          name={name}
          email={email}
          role={role}
          memberSince={memberSince}
          department={user?.department}
          jobTitle={user?.jobTitle}
          avatarUrl={user?.avatarUrl}
          lastOidcSync={lastOidcSync}
          gender={user?.gender}
        />
      </SettingsSection>

      <SettingsSection
        title="General Preferences"
        description="Set your timezone, summary preferences, and personal quiet hours."
      >
        <PreferencesForm timeZone={user?.timeZone ?? 'UTC'} />

        <div className="mt-6 border-t pt-6">
          <QuietHoursForm
            enabled={user?.quietHoursEnabled ?? false}
            startMinutes={user?.quietHoursStartMinutes ?? 18 * 60}
            endMinutes={user?.quietHoursEndMinutes ?? 8 * 60}
            weekendAllDay={user?.quietHoursWeekendAllDay ?? true}
            timeZone={timeZone}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Notification Preferences"
        description="Choose how and when you want to receive incident notifications."
        footer={
          <p className="text-sm text-muted-foreground">
            Preference updates apply to this workspace once saved.
          </p>
        }
      >
        <NotificationPreferencesForm
          emailEnabled={user?.emailNotificationsEnabled ?? false}
          smsEnabled={user?.smsNotificationsEnabled ?? false}
          pushEnabled={user?.pushNotificationsEnabled ?? false}
          whatsappEnabled={user?.whatsappNotificationsEnabled ?? false}
          phoneNumber={user?.phoneNumber ?? null}
        />
      </SettingsSection>
    </div>
  );
}
