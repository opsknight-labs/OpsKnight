import prisma from '@/lib/prisma';
import { getAuthOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';
import ProfileForm from '@/components/settings/ProfileForm';
import PreferencesForm from '@/components/settings/PreferencesForm';
import NotificationPreferencesForm from '@/components/settings/NotificationPreferencesForm';
import QuietHoursForm from '@/components/settings/QuietHoursForm';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import UserAvatar from '@/components/UserAvatar';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { getDefaultAvatar } from '@/lib/avatar';
import { Mail, Briefcase, Building2, Clock, RefreshCw, Users, Calendar, Flame } from 'lucide-react';

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

export default async function ProfileSettingsPage() {
  const session = await getServerSession(await getAuthOptions());
  const email = session?.user?.email ?? null;

  // Fetch user data with operational counts for hero stats
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
          // Operational counts for hero stats
          _count: {
            select: {
              teamMemberships: true,
              layerAssignments: true,
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

  return (
    <div className="space-y-6">
      {/* Centralized Hero Banner — Same pattern as /users/[id] */}
      <DetailHeroBanner
        breadcrumb={{
          label: 'Settings',
          href: '/settings',
          current: 'Profile & Preferences',
        }}
        tag="Personal Account"
        title={name}
        icon={
          <UserAvatar
            userId={user?.id || 'unknown'}
            name={name}
            avatarUrl={user?.avatarUrl || getDefaultAvatar(user?.gender, email || 'user')}
            gender={user?.gender}
            size="xl"
            showOnlineStatus={user?.status === 'ACTIVE'}
            className="shrink-0 ring-2 ring-primary-foreground/20 rounded-full"
          />
        }
        badges={
          <>
            <Badge
              variant="outline"
              size="xs"
              className="bg-primary-foreground/15 text-primary-foreground border-primary-foreground/25 uppercase font-bold text-[10px] tracking-wider"
            >
              {role}
            </Badge>

            {lastOidcSync ? (
              <Badge
                variant="outline"
                size="xs"
                className="bg-emerald-500/20 text-emerald-100 border-emerald-400/30 font-medium text-[10px] gap-1"
              >
                <RefreshCw className="h-2.5 w-2.5" /> SSO Synced
              </Badge>
            ) : (
              <Badge
                variant="outline"
                size="xs"
                className="bg-primary-foreground/10 text-primary-foreground/90 border-primary-foreground/20 text-[10px]"
              >
                Direct Account
              </Badge>
            )}

            {user?.status === 'ACTIVE' && (
              <Badge
                variant="outline"
                size="xs"
                className="bg-emerald-500/20 text-emerald-100 border-emerald-400/30 font-medium text-[10px]"
              >
                Active
              </Badge>
            )}
          </>
        }
        subtitle={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a
              href={`mailto:${email}`}
              className="flex items-center gap-1.5 font-mono hover:text-white hover:underline transition-colors"
            >
              <Mail className="h-3.5 w-3.5 opacity-80" />
              <span>{email}</span>
            </a>

            {user?.jobTitle && (
              <span className="flex items-center gap-1.5">
                <Briefcase className="h-3.5 w-3.5 opacity-80" />
                <span>{user.jobTitle}</span>
              </span>
            )}

            {user?.department && (
              <span className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 opacity-80" />
                <span>{user.department}</span>
              </span>
            )}

            <span className="flex items-center gap-1.5 bg-primary-foreground/10 px-2 py-0.5 rounded border border-primary-foreground/15">
              <Clock className="h-3 w-3 opacity-80" />
              <span>{localTimeStr}</span>
            </span>
          </div>
        }
        stats={[
          {
            label: 'Teams',
            value: user?._count?.teamMemberships ?? 0,
            icon: <Users className="h-3.5 w-3.5" />,
          },
          {
            label: 'On-Call',
            value: user?._count?.layerAssignments ?? 0,
            icon: <Calendar className="h-3.5 w-3.5" />,
          },
          {
            label: 'Incidents',
            value: user?._count?.assignedIncidents ?? 0,
            icon: <Flame className="h-3.5 w-3.5" />,
          },
        ]}
      />

      {/* Profile Photo + Personal Information + Account Details */}
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

      {/* Timezone Preferences */}
      <SettingsSection
        title="Timezone"
        description="Your primary timezone for incident timestamps, on-call schedules, and analytics"
      >
        <div className="py-2">
          <PreferencesForm timeZone={user?.timeZone ?? 'UTC'} />
        </div>
      </SettingsSection>

      {/* Notification Channels */}
      <NotificationPreferencesForm
        emailEnabled={user?.emailNotificationsEnabled ?? false}
        smsEnabled={user?.smsNotificationsEnabled ?? false}
        pushEnabled={user?.pushNotificationsEnabled ?? false}
        whatsappEnabled={user?.whatsappNotificationsEnabled ?? false}
        phoneNumber={user?.phoneNumber ?? null}
      />

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
    </div>
  );
}
