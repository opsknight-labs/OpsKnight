import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import { SlackLogo } from '@/components/common/BrandLogos';
import { Shield, MessageSquare, Video, Archive, CheckCircle2, AlertTriangle } from 'lucide-react';
import ChatOpsSettingsPage from '@/components/settings/ChatOpsSettingsPage';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function GlobalChatOpsIntegrationPage() {
  const permissions = await getUserPermissions();
  if (!permissions) redirect('/login');
  if (!permissions.isAdmin) redirect('/settings');

  const config = await prisma.chatOpsConfig.findUnique({
    where: { id: 'default' },
  });

  const slackIntegration = await prisma.slackIntegration.findFirst({
    where: { services: { none: {} }, enabled: true },
  });

  const isSlackConnected = !!slackIntegration?.botToken;
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
        breadcrumb={{ label: 'Settings', href: '/settings', current: 'ChatOps Integration' }}
        tag="REAL-TIME INCIDENT COLLABORATION"
        title="ChatOps & Incident War Rooms"
        subtitle="Automate dedicated Slack incident channels, multi-responder paging, and instant video war rooms."
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
                isSlackConnected
                  ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-100'
                  : 'border-rose-400/60 bg-rose-400/15 text-rose-100'
              }`}
            >
              {isSlackConnected ? (
                <>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Slack Connected
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Slack Disconnected
                </>
              )}
            </Badge>
          </div>
        }
        statsPlacement="bottom"
        stats={[
          {
            label: 'Channel Prefix',
            value: `#${channelPrefix}-`,
            icon: <SlackLogo className="h-4 w-4" />,
            valueClassName: 'text-primary-foreground font-mono text-xs',
            subtext: config?.enabled ? 'Engine active' : 'Engine paused',
          },
          {
            label: 'Auto-Create Triggers',
            value: triggerSummary,
            icon: <MessageSquare className="h-4 w-4" />,
            valueClassName: hasTriggers
              ? 'text-emerald-300 font-mono text-xs'
              : 'text-primary-foreground/70',
            subtext: hasTriggers ? 'Auto-spawn on incident' : 'No triggers set',
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
            label: 'Channel Lifecycle',
            value: config?.archiveOnResolve ? 'Auto-Archive' : 'Persistent',
            icon: <Archive className="h-4 w-4" />,
            valueClassName: config?.archiveOnResolve
              ? 'text-emerald-300'
              : 'text-primary-foreground/70',
            subtext: config?.archiveOnResolve ? 'Archived upon resolution' : 'Retained in Slack',
          },
        ]}
      />

      <ChatOpsSettingsPage
        config={config}
        isAdmin={permissions.isAdmin}
        isSlackConnected={isSlackConnected}
      />
    </div>
  );
}
