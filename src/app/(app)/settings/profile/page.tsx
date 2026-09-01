import prisma from '@/lib/prisma';
import { getAuthOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';
import ProfileForm from '@/components/settings/ProfileForm';
import PreferencesForm from '@/components/settings/PreferencesForm';
import NotificationPreferencesForm from '@/components/settings/NotificationPreferencesForm';
import QuietHoursForm from '@/components/settings/QuietHoursForm';
import ProfileDetailTabs from '@/components/settings/ProfileDetailTabs';
import ProfileHeroBanner from '@/components/settings/ProfileHeroBanner';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { Users, Calendar, Flame } from 'lucide-react';

export const revalidate = 0;

type ProfileSettingsPageProps = {
  searchParams?: Promise<{ tab?: string }>;
};

function formatLocalTimeInTz(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: timeZone || 'UTC',
      hour: 'numeric',
      minute: 'numeric',
      hour12: true,
      timeZoneName: 'short',
    }).format(new Date());
  } catch {
    return 'UTC';
  }
}

export default async function ProfileSettingsPage({ searchParams }: ProfileSettingsPageProps) {
  const resolvedSearchParams = await searchParams;
  const defaultTab = resolvedSearchParams?.tab || 'profile';

  const session = await getServerSession(await getAuthOptions());
  const email = session?.user?.email ?? null;

  // Fetch full user profile along with team memberships, schedules, and policies
  const user = email
    ? await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          name: true,
          role: true,
          status: true,
          createdAt: true,
          timeZone: true,
          department: true,
          jobTitle: true,
          avatarUrl: true,
          gender: true,
          lastOidcSync: true,
          emailNotificationsEnabled: true,
          smsNotificationsEnabled: true,
          pushNotificationsEnabled: true,
          whatsappNotificationsEnabled: true,
          phoneNumber: true,
          quietHoursEnabled: true,
          quietHoursStartMinutes: true,
          quietHoursEndMinutes: true,
          quietHoursWeekendAllDay: true,
          teamMemberships: {
            include: {
              team: {
                select: { id: true, name: true, description: true },
              },
            },
            orderBy: { team: { name: 'asc' } },
          },
          teamsLed: {
            select: { id: true, name: true },
          },
          layerAssignments: {
            include: {
              layer: {
                include: {
                  schedule: {
                    select: { id: true, name: true, timeZone: true },
                  },
                },
              },
            },
          },
          escalationRules: {
            include: {
              policy: {
                select: { id: true, name: true, description: true },
              },
            },
            orderBy: { stepOrder: 'asc' },
          },
          _count: {
            select: {
              assignedIncidents: true,
            },
          },
        },
      })
    : null;

  const name = user?.name || session?.user?.name || 'User';
  const role = user?.role || (session?.user as any)?.role || 'USER'; // eslint-disable-line @typescript-eslint/no-explicit-any
  const timeZone = getUserTimeZone(user ?? undefined);
  const memberSince = user?.createdAt
    ? formatDateTime(user.createdAt, timeZone, { format: 'date' })
    : 'Recently';
  const lastOidcSync = user?.lastOidcSync
    ? formatDateTime(user.lastOidcSync, timeZone, { format: 'datetime' })
    : null;

  const localTimeStr = formatLocalTimeInTz(timeZone);

  const totalTeams = user?.teamMemberships?.length ?? 0;
  const totalSchedules = user?.layerAssignments?.length ?? 0;
  const totalIncidents = user?._count?.assignedIncidents ?? 0;

  const activeChannelsCount = [
    user?.emailNotificationsEnabled ?? false,
    (user?.smsNotificationsEnabled ?? false) && !!user?.phoneNumber,
    (user?.whatsappNotificationsEnabled ?? false) && !!user?.phoneNumber,
    user?.pushNotificationsEnabled ?? false,
  ].filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Centralized Hero Header — Single unified avatar with interactive controls */}
      <ProfileHeroBanner
        user={{
          id: user?.id || 'unknown',
          name: name,
          email: email,
          role: role,
          avatarUrl: user?.avatarUrl,
          gender: user?.gender,
          status: user?.status,
          department: user?.department,
          jobTitle: user?.jobTitle,
          lastOidcSync: lastOidcSync ? String(lastOidcSync) : null,
          timeZone: timeZone,
        }}
        localTime={localTimeStr}
        stats={[
          {
            label: 'Teams',
            value: totalTeams,
            icon: <Users className="h-3.5 w-3.5" />,
          },
          {
            label: 'On-Call',
            value: totalSchedules,
            icon: <Calendar className="h-3.5 w-3.5" />,
          },
          {
            label: 'Incidents',
            value: totalIncidents,
            icon: <Flame className="h-3.5 w-3.5" />,
          },
        ]}
      />

      {/* Centralized Tabbed Workspace — Instant 0ms Smooth Switching */}
      <ProfileDetailTabs
        defaultTab={defaultTab}
        activeChannelsCount={activeChannelsCount}
        teams={user?.teamMemberships ?? []}
        teamsLed={user?.teamsLed ?? []}
        layerAssignments={user?.layerAssignments ?? []}
        escalationRules={user?.escalationRules ?? []}
        profileContent={
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
        }
        notificationsContent={
          <NotificationPreferencesForm
            emailEnabled={user?.emailNotificationsEnabled ?? false}
            smsEnabled={user?.smsNotificationsEnabled ?? false}
            pushEnabled={user?.pushNotificationsEnabled ?? false}
            whatsappEnabled={user?.whatsappNotificationsEnabled ?? false}
            phoneNumber={user?.phoneNumber ?? null}
          />
        }
        scheduleContent={
          <>
            {/* Timezone Preferences */}
            <SettingsSection
              title="Timezone"
              description="Your primary timezone for incident timestamps, on-call schedules, and analytics"
            >
              <div className="py-2">
                <PreferencesForm timeZone={user?.timeZone ?? 'UTC'} />
              </div>
            </SettingsSection>

            {/* Quiet Hours */}
            <SettingsSection
              title="Quiet Hours"
              description="Silence non-critical alerts during your resting schedule"
              footer={
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Flame className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  Critical and P1 incidents always bypass quiet hours to ensure safety.
                </p>
              }
            >
              <div className="py-2">
                <QuietHoursForm
                  enabled={user?.quietHoursEnabled ?? false}
                  startMinutes={user?.quietHoursStartMinutes ?? 18 * 60}
                  endMinutes={user?.quietHoursEndMinutes ?? 8 * 60}
                  weekendAllDay={user?.quietHoursWeekendAllDay ?? true}
                  timeZone={timeZone}
                />
              </div>
            </SettingsSection>
          </>
        }
      />
    </div>
  );
}
