import prisma from '@/lib/prisma';
import { getSlackBotScopes } from '@/lib/slack';
import { slackDmEligibility } from '@/lib/slack/health';
import { getAuthOptions } from '@/lib/auth';
import { getServerSession } from 'next-auth';
import ProfileForm from '@/components/settings/ProfileForm';
import { userIdentityStatus } from '@/lib/users/identity-status';
import PreferencesForm from '@/components/settings/PreferencesForm';
import NotificationPreferencesForm from '@/components/settings/NotificationPreferencesForm';
import BlockedEndpointsNotice from '@/components/settings/BlockedEndpointsNotice';
import WeeklyDigestToggle from '@/components/settings/WeeklyDigestToggle';
import MyServiceReview from '@/components/settings/MyServiceReview';
import SquireHeadsUpSettings from '@/components/settings/SquireHeadsUpSettings';
import { hasConfiguredEmailProvider, isWeeklyDigestEnabled } from '@/lib/analytics/digest';
import QuietHoursForm from '@/components/settings/QuietHoursForm';
import NoiseSettings from '@/components/settings/NoiseSettings';
import ProfileDetailTabs from '@/components/settings/ProfileDetailTabs';
import ProfileHeroBanner from '@/components/settings/ProfileHeroBanner';
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import AppearanceControl from '@/components/theme/AppearanceControl';
import { getUserTimeZone, formatDateTime } from '@/lib/timezone';
import { calculateActorSLAMetrics } from '@/lib/actor-metrics';
import { getCurrentAuthorizationActor } from '@/lib/rbac';
import { Users, Calendar, Flame, ShieldCheck } from 'lucide-react';
import ConnectedChatOpsAccounts from '@/components/settings/ConnectedChatOpsAccounts';
import { requirePageAccess } from '@/lib/access/server';

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
  await requirePageAccess('/settings/profile');
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
          voiceNotificationsEnabled: true,
          pushNotificationsEnabled: true,
          whatsappNotificationsEnabled: true,
          slackNotificationsEnabled: true,
          analyticsDigest: { select: { optedOut: true } },
          squireSettings: { select: { headsUpEnabled: true, headsUpLeadMinutes: true } },
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
  const blockedEndpoints = user
    ? await prisma.userNotificationEndpoint.findMany({
        where: {
          userId: user.id,
          status: { in: ['INVALID', 'BOUNCED'] },
          channel: { in: ['EMAIL', 'SMS', 'VOICE', 'WHATSAPP', 'PUSH'] },
        },
        select: { channel: true, status: true },
        orderBy: { channel: 'asc' },
      })
    : [];
  const chatIdentityLinks = user
    ? await prisma.chatIdentityLink.findMany({
        where: { userId: user.id, revokedAt: null },
        select: { id: true, provider: true, providerTenantId: true, displayName: true },
        orderBy: { verifiedAt: 'desc' },
      })
    : [];

  const name = user?.name || session?.user?.name || 'User';
  const role = user?.role || (session?.user as any)?.role || 'USER'; // eslint-disable-line @typescript-eslint/no-explicit-any
  const timeZone = getUserTimeZone(user ?? undefined);
  const memberSince = user?.createdAt
    ? formatDateTime(user.createdAt, timeZone, { format: 'date' })
    : 'Recently';
  const identity = user?.id
    ? await userIdentityStatus(user.id)
    : { ssoLinked: false, managedFields: {} };
  const lastOidcSync = user?.lastOidcSync
    ? formatDateTime(user.lastOidcSync, timeZone, { format: 'datetime' })
    : null;

  const localTimeStr = formatLocalTimeInTz(timeZone);

  // Centralized SLA Metrics Calculation for Current User (Last 30 Days)
  const actor = user?.id ? await getCurrentAuthorizationActor() : null;
  const slaMetrics =
    user?.id && actor
      ? await calculateActorSLAMetrics(actor, {
          assigneeId: user.id,
          userTimeZone: timeZone,
          windowDays: 30,
        })
      : null;
  // The metrics object carries an internal accumulator under a Symbol key. Client components accept only
  // plain objects, and passing it made every refresh (e.g. after picking an avatar) log a React error.
  const slaMetricsForClient = slaMetrics ? Object.fromEntries(Object.entries(slaMetrics)) : null;

  const totalTeams = user?.teamMemberships?.length ?? 0;
  const totalSchedules = user?.layerAssignments?.length ?? 0;
  const totalIncidents = user?._count?.assignedIncidents ?? 0;

  const activeChannelsCount = [
    user?.emailNotificationsEnabled ?? false,
    (user?.smsNotificationsEnabled ?? false) && !!user?.phoneNumber,
    (user?.voiceNotificationsEnabled ?? false) && !!user?.phoneNumber,
    (user?.whatsappNotificationsEnabled ?? false) && !!user?.phoneNumber,
    user?.pushNotificationsEnabled ?? false,
    user?.slackNotificationsEnabled ?? false,
  ].filter(Boolean).length;
  const slackDmCheck = slackDmEligibility(await getSlackBotScopes().catch(() => []));
  const slackDm = { available: slackDmCheck.eligible, reason: slackDmCheck.reason };

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
          {
            label: 'SLA',
            value:
              slaMetrics &&
              (slaMetrics.resolveCompliance !== null || slaMetrics.ackCompliance !== null)
                ? `${(slaMetrics.resolveCompliance ?? slaMetrics.ackCompliance)!.toFixed(0)}%`
                : '—',
            icon: <ShieldCheck className="h-3.5 w-3.5" />,
            subtext:
              slaMetrics &&
              (slaMetrics.resolveCompliance !== null || slaMetrics.ackCompliance !== null)
                ? 'Last 30 days'
                : 'No evaluable SLA data',
            tooltip: 'SLA compliance score for the last 30 days',
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
        slaMetrics={slaMetricsForClient as typeof slaMetrics}
        profileContent={
          <>
            <ProfileForm
              name={name}
              email={email}
              role={role}
              memberSince={memberSince}
              department={user?.department}
              jobTitle={user?.jobTitle}
              avatarUrl={user?.avatarUrl}
              lastOidcSync={lastOidcSync}
              ssoLinked={identity.ssoLinked}
              managedFields={identity.managedFields}
            />
            {chatIdentityLinks.length > 0 && <ConnectedChatOpsAccounts links={chatIdentityLinks} />}
          </>
        }
        notificationsContent={
          <>
            <BlockedEndpointsNotice endpoints={blockedEndpoints} />
            <NotificationPreferencesForm
              emailEnabled={user?.emailNotificationsEnabled ?? false}
              smsEnabled={user?.smsNotificationsEnabled ?? false}
              voiceEnabled={user?.voiceNotificationsEnabled ?? false}
              pushEnabled={user?.pushNotificationsEnabled ?? false}
              whatsappEnabled={user?.whatsappNotificationsEnabled ?? false}
              phoneNumber={user?.phoneNumber ?? null}
              slackEnabled={user?.slackNotificationsEnabled ?? false}
              slackDm={slackDm}
            />
            {user?.id && <NoiseSettings viewer={{ id: user.id }} />}
            <WeeklyDigestToggle
              scope="me"
              enabled={!user?.analyticsDigest?.optedOut}
              workspaceEnabled={await isWeeklyDigestEnabled()}
              emailReady={await hasConfiguredEmailProvider()}
            />
            {user?.id && <MyServiceReview userId={user.id} />}
            <SquireHeadsUpSettings
              enabled={user?.squireSettings?.headsUpEnabled ?? true}
              leadMinutes={user?.squireSettings?.headsUpLeadMinutes ?? 60}
            />
          </>
        }
        scheduleContent={
          <>
            {/* Timezone Preferences */}
            <SettingsSection
              title="Appearance"
              description="Choose a light or dark interface, or follow your device. Saved to your account, so it applies on every device you sign in to."
            >
              <div className="max-w-sm py-2">
                <AppearanceControl />
              </div>
            </SettingsSection>

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
              description="Silence low-urgency notifications (SMS, Voice, Push, WhatsApp) during your resting schedule"
              footer={
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <Flame className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  Medium and High urgency alerts always bypass quiet hours to ensure operational
                  safety.
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
