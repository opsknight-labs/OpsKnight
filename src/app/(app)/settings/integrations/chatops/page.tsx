import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import { Shield, MessageSquare, Video, Archive, Users, Hash } from 'lucide-react';
import ChatOpsSettingsPage from '@/components/settings/ChatOpsSettingsPage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function GlobalChatOpsIntegrationPage() {
  const permissions = await getUserPermissions();
  if (!permissions) redirect('/login');
  if (!permissions.isAdmin) redirect('/settings');

  const [config, slackIntegration, teamsConfig, teamsDestinationsCount] = await Promise.all([
    prisma.chatOpsConfig.findUnique({
      where: { id: 'default' },
    }),
    prisma.slackIntegration.findFirst({
      where: { services: { none: {} }, enabled: true },
    }),
    prisma.microsoftTeamsConfig.findUnique({
      where: { id: 'default' },
    }),
    prisma.microsoftTeamsDestination.count({
      where: { enabled: true, warRoomEnabled: true },
    }),
  ]);

  const isSlackConnected = !!slackIntegration?.botToken;
  const isTeamsConnected = !!teamsConfig?.enabled;
  const isTeamsWarRoomsEnabled = !!teamsConfig?.warRoomsEnabled;

  const connectedProvidersCount = [isSlackConnected, isTeamsConnected].filter(Boolean).length;
  const channelPrefix = config?.channelPrefix || 'inc';
  const hasTriggers =
    (config?.autoCreateOnPriority?.length ?? 0) > 0 ||
    (config?.autoCreateOnUrgency?.length ?? 0) > 0;
  const triggerSummary = config?.autoCreateOnPriority?.length
    ? config.autoCreateOnPriority.join(', ')
    : hasTriggers
      ? 'Urgency only'
      : 'Manual only';

  const bridgeLabelMap: Record<string, string> = {
    JITSI: 'Jitsi Meet',
    ZOOM: 'Zoom',
    GOOGLE_MEET: 'Google Meet',
    NONE: 'Disabled',
  };
  const bridgeDisplay = bridgeLabelMap[config?.defaultVideoBridge ?? 'JITSI'] || 'Jitsi Meet';

  return (
    <div className="space-y-6">
      <DetailHeroBanner
        breadcrumb={{ label: 'Settings', href: '/settings', current: 'War Rooms & ChatOps' }}
        tag="INCIDENT COLLABORATION"
        title="War Rooms & ChatOps"
        subtitle="Centralize how OpsKnight creates and manages incident collaboration rooms across connected providers."
        badges={
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className="border-primary-foreground/30 bg-primary-foreground/10 text-primary-foreground text-[10px] font-semibold"
            >
              <Shield className="h-3 w-3 mr-1" />
              Admin Only
            </Badge>
            <Badge
              variant="outline"
              className={`text-[10px] font-semibold ${
                connectedProvidersCount > 0
                  ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-100'
                  : 'border-amber-400/60 bg-amber-400/15 text-amber-100'
              }`}
            >
              <Users className="h-3 w-3 mr-1" />
              {connectedProvidersCount === 0
                ? 'No Providers Connected'
                : `${connectedProvidersCount} Provider${connectedProvidersCount > 1 ? 's' : ''} Connected`}
            </Badge>
          </div>
        }
        statsPlacement="bottom"
        stats={[
          {
            label: 'Room Name Prefix',
            value: `${channelPrefix}-`,
            icon: <Hash className="h-4 w-4" />,
            valueClassName: 'text-primary-foreground font-mono text-xs',
            subtext: config?.enabled ? 'Provisioning active' : 'Provisioning paused',
          },
          {
            label: 'Auto-Create Triggers',
            value: triggerSummary,
            icon: <MessageSquare className="h-4 w-4" />,
            valueClassName: hasTriggers
              ? 'text-emerald-300 font-mono text-xs'
              : 'text-primary-foreground/70',
            subtext: hasTriggers ? 'Auto-request on incident' : 'No triggers set',
          },
          {
            label: 'Video War Room',
            value: bridgeDisplay,
            icon: <Video className="h-4 w-4" />,
            valueClassName:
              config?.defaultVideoBridge === 'NONE'
                ? 'text-primary-foreground/70'
                : 'text-emerald-300',
            subtext:
              config?.defaultVideoBridge === 'NONE' ? 'Video bridge off' : 'Instant meeting link',
          },
          {
            label: 'Lifecycle Behavior',
            value: config?.archiveOnResolve ? 'Auto-Close' : 'Persistent',
            icon: <Archive className="h-4 w-4" />,
            valueClassName: config?.archiveOnResolve
              ? 'text-emerald-300'
              : 'text-primary-foreground/70',
            subtext: config?.archiveOnResolve ? 'Close on resolution' : 'Retained in channel',
          },
        ]}
      />

      <ChatOpsSettingsPage
        config={config}
        isAdmin={permissions.isAdmin}
        providerStatus={{
          slack: {
            connected: isSlackConnected,
            workspaceName: slackIntegration?.workspaceName || null,
          },
          teams: {
            connected: isTeamsConnected,
            warRoomsEnabled: isTeamsWarRoomsEnabled,
            destinationsCount: teamsDestinationsCount,
          },
        }}
      />
    </div>
  );
}
