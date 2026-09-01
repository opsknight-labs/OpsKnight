import prisma from '@/lib/prisma';
import { getAuthOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';
import ProfileForm from '@/components/settings/ProfileForm';
import PreferencesForm from '@/components/settings/PreferencesForm';
import NotificationPreferencesForm from '@/components/settings/NotificationPreferencesForm';
import QuietHoursForm from '@/components/settings/QuietHoursForm';
import DetailHeroBanner, { type DetailStatItem } from '@/components/ui/DetailHeroBanner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/shadcn/tabs';
import { Badge } from '@/components/ui/shadcn/badge';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/shadcn/avatar';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { getDefaultAvatar } from '@/lib/avatar';
import {
  User,
  Bell,
  Clock,
  Shield,
  Moon,
  Calendar,
  Sparkles,
  CheckCircle2,
  RefreshCw,
} from 'lucide-react';

function minutesToTime(minutes: number): string {
  const safeMinutes = Number.isInteger(minutes) && minutes >= 0 && minutes < 1440 ? minutes : 0;
  const hours = Math.floor(safeMinutes / 60);
  const mins = safeMinutes % 60;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(mins).padStart(2, '0')} ${ampm}`;
}

export default async function ProfileSettingsPage() {
  const session = await getServerSession(await getAuthOptions());
  const email = session?.user?.email ?? null;

  // Fetch user data from database
  const user = email
    ? await prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          name: true,
          role: true,
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

  const activeChannelsCount = [
    user?.emailNotificationsEnabled ?? false,
    (user?.smsNotificationsEnabled ?? false) && !!user?.phoneNumber,
    (user?.whatsappNotificationsEnabled ?? false) && !!user?.phoneNumber,
    user?.pushNotificationsEnabled ?? false,
  ].filter(Boolean).length;

  const quietHoursLabel = user?.quietHoursEnabled
    ? `${minutesToTime(user.quietHoursStartMinutes ?? 18 * 60)} - ${minutesToTime(user.quietHoursEndMinutes ?? 8 * 60)}`
    : 'Disabled';

  const initials = (name || 'User')
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const heroStats: DetailStatItem[] = [
    {
      label: 'Role',
      value: role,
      icon: <Shield className="h-3.5 w-3.5 text-primary-foreground/80" />,
      subtext: 'Permissions Level',
    },
    {
      label: 'Timezone',
      value: timeZone.split('/')[1]?.replace(/_/g, ' ') || timeZone,
      icon: <Clock className="h-3.5 w-3.5 text-primary-foreground/80" />,
      subtext: timeZone,
    },
    {
      label: 'Channels',
      value: `${activeChannelsCount} / 4`,
      icon: <Bell className="h-3.5 w-3.5 text-primary-foreground/80" />,
      subtext: 'Alert Delivery',
    },
    {
      label: 'Quiet Hours',
      value: user?.quietHoursEnabled ? 'Active' : 'Off',
      icon: <Moon className="h-3.5 w-3.5 text-primary-foreground/80" />,
      subtext: quietHoursLabel,
    },
    {
      label: 'Member Since',
      value: memberSince,
      icon: <Calendar className="h-3.5 w-3.5 text-primary-foreground/80" />,
      subtext: 'Workspace Access',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Centralized Glassmorphic Hero Banner */}
      <DetailHeroBanner
        breadcrumb={{
          label: 'Settings',
          href: '/settings',
          current: 'Profile & Preferences',
        }}
        tag="Personal Account"
        title={name}
        subtitle={
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono">{email}</span>
            {user?.jobTitle && <span>· {user.jobTitle}</span>}
            {user?.department && <span>· {user.department}</span>}
          </div>
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
          </>
        }
        icon={
          <Avatar className="h-16 w-16 border-2 border-primary-foreground/30 shadow-md ring-2 ring-primary-foreground/20 rounded-full">
            <AvatarImage
              src={user?.avatarUrl || getDefaultAvatar(user?.gender, email || 'user')}
              alt={name}
              className="object-cover"
            />
            <AvatarFallback className="text-xl font-bold bg-primary-foreground/20 text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
        }
        stats={heroStats}
        statsPlacement="bottom"
      />

      {/* Tabbed Profile Navigation */}
      <Tabs defaultValue="profile" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 max-w-lg h-11 p-1 bg-muted/60">
          <TabsTrigger value="profile" className="gap-2 text-xs font-semibold py-2">
            <User className="h-3.5 w-3.5" />
            Profile & Identity
          </TabsTrigger>

          <TabsTrigger value="notifications" className="gap-2 text-xs font-semibold py-2">
            <Bell className="h-3.5 w-3.5" />
            Notification Channels
          </TabsTrigger>

          <TabsTrigger value="schedule" className="gap-2 text-xs font-semibold py-2">
            <Moon className="h-3.5 w-3.5" />
            Timezone & Quiet Hours
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Profile Details */}
        <TabsContent value="profile" className="space-y-6">
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
        </TabsContent>

        {/* Tab 2: Notification Preferences */}
        <TabsContent value="notifications" className="space-y-6">
          <NotificationPreferencesForm
            emailEnabled={user?.emailNotificationsEnabled ?? false}
            smsEnabled={user?.smsNotificationsEnabled ?? false}
            pushEnabled={user?.pushNotificationsEnabled ?? false}
            whatsappEnabled={user?.whatsappNotificationsEnabled ?? false}
            phoneNumber={user?.phoneNumber ?? null}
          />
        </TabsContent>

        {/* Tab 3: Timezone & Quiet Hours */}
        <TabsContent value="schedule" className="space-y-6">
          <SettingsSection
            title="Timezone Preferences"
            description="Configure your primary timezone for incident timestamps, schedules, and analytics"
          >
            <div className="py-2">
              <PreferencesForm timeZone={user?.timeZone ?? 'UTC'} />
            </div>
          </SettingsSection>

          <SettingsSection
            title="Personal Quiet Hours"
            description="Silence non-critical alerts during your resting schedule"
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
