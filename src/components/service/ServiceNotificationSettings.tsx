'use client';

import { useState, useEffect, useRef } from 'react';
import { logger } from '@/lib/logger';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/shadcn/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import { Button } from '@/components/ui/shadcn/button';
import { Label } from '@/components/ui/shadcn/label';
import { Checkbox } from '@/components/ui/shadcn/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/shadcn/select';
import {
  Info,
  Check,
  AlertTriangle,
  XCircle,
  RefreshCw,
  Send,
  Webhook,
  Plus,
  Loader2,
  MessageSquare,
  BellRing,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { SlackLogo, MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import AddWebhookDialog from '@/components/service/AddWebhookDialog';
import { updateServiceNotificationSettings } from '@/app/(app)/services/actions';

type ServiceNotificationSettingsProps = {
  serviceId: string;
  serviceNotificationChannels: string[];
  slackChannel: string | null;
  slackWebhookUrl: string | null;
  slackIntegration: {
    id: string;
    workspaceName: string | null;
    workspaceId: string;
    enabled: boolean;
  } | null;
  webhookIntegrations: Array<{
    id: string;
    name: string;
    type: string;
    url: string;
    enabled: boolean;
  }>;
  serviceNotifyOnTriggered: boolean;
  serviceNotifyOnAck: boolean;
  serviceNotifyOnResolved: boolean;
  serviceNotifyOnSlaBreach: boolean;
  children?: React.ReactNode;
};

export default function ServiceNotificationSettings({
  serviceId,
  serviceNotificationChannels,
  slackChannel,
  slackWebhookUrl,
  slackIntegration,
  webhookIntegrations,
  serviceNotifyOnTriggered,
  serviceNotifyOnAck,
  serviceNotifyOnResolved,
  serviceNotifyOnSlaBreach,
  children,
}: ServiceNotificationSettingsProps) {
  const saveNotificationSettings = updateServiceNotificationSettings.bind(null, serviceId);
  const [channels, setChannels] = useState<string[]>(serviceNotificationChannels || []);
  const [notifyOnTriggered, setNotifyOnTriggered] = useState(serviceNotifyOnTriggered ?? true);
  const [notifyOnAck, setNotifyOnAck] = useState(serviceNotifyOnAck ?? true);
  const [notifyOnResolved, setNotifyOnResolved] = useState(serviceNotifyOnResolved ?? true);
  const [notifyOnSlaBreach, setNotifyOnSlaBreach] = useState(serviceNotifyOnSlaBreach ?? false);
  const [selectedSlackChannel, setSelectedSlackChannel] = useState(slackChannel || '');
  const [slackChannels, setSlackChannels] = useState<
    Array<{ id: string; name: string; isMember: boolean; isPrivate: boolean }>
  >([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [joinState, setJoinState] = useState<{
    status: 'idle' | 'joining' | 'success' | 'error';
    message: string | null;
    channelId: string | null;
  }>({ status: 'idle', message: null, channelId: null });
  const [testState, setTestState] = useState<{
    testing: boolean;
    result: 'success' | 'error' | null;
  }>({ testing: false, result: null });

  // Microsoft Teams discovery
  const [teams, setTeams] = useState<
    Array<{ id: string; displayName: string; description?: string | null }>
  >([]);
  const [teamsChannels, setTeamsChannels] = useState<
    Array<{ id: string; displayName: string; description?: string | null }>
  >([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [selectedTeamsChannelId, setSelectedTeamsChannelId] = useState<string>('');
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [teamsChannelsLoading, setTeamsChannelsLoading] = useState(false);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [teamsChannelsError, setTeamsChannelsError] = useState<string | null>(null);
  const [teamsLinking, setTeamsLinking] = useState(false);
  const [teamsLinkResult, setTeamsLinkResult] = useState<{
    status: 'success' | 'error';
    message: string;
  } | null>(null);
  const [existingTeamsDest, setExistingTeamsDest] = useState<null | {
    id: string;
    teamName: string | null;
    channelName: string | null;
    tenantId: string;
    teamId: string;
    channelId: string;
  }>(null);

  // Ref for native validation (if using hidden native select for form submission)
  const selectRef = useRef<HTMLInputElement>(null);

  // Validation effect - adapted for custom select
  useEffect(() => {
    if (!selectRef.current) return;

    if (!channels.includes('SLACK') || !selectedSlackChannel) {
      selectRef.current.setCustomValidity('');
      return;
    }

    const channel = slackChannels.find(ch => ch.name === selectedSlackChannel);
    if (channel && !channel.isMember) {
      selectRef.current.setCustomValidity('Bot must be connected to this channel before saving.');
    } else {
      selectRef.current.setCustomValidity('');
    }
  }, [selectedSlackChannel, slackChannels, channels]);

  const refreshChannels = () => {
    if (!slackIntegration) return;
    setLoadingChannels(true);
    setChannelsError(null);
    fetch(`/api/slack/channels?serviceId=${encodeURIComponent(serviceId)}`)
      .then(async res => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Failed to load channels');
        return data;
      })
      .then(data => {
        if (data.channels) setSlackChannels(data.channels);
      })
      .catch(err => setChannelsError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoadingChannels(false));
  };

  const handleTestNotification = async () => {
    const channel = slackChannels.find(ch => ch.name === selectedSlackChannel);
    if (!channel || !channel.isMember) return;
    setTestState({ testing: true, result: null });
    try {
      const res = await fetch('/api/slack/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId, channelId: channel.id, channelName: channel.name }),
      });
      setTestState({ testing: false, result: res.ok ? 'success' : 'error' });
      setTimeout(() => setTestState({ testing: false, result: null }), 3000);
    } catch {
      setTestState({ testing: false, result: 'error' });
    }
  };

  // Fetch Slack channels when Slack is selected or integration exists
  useEffect(() => {
    if (slackIntegration) {
      setLoadingChannels(true);
      setChannelsError(null);
      fetch(`/api/slack/channels?serviceId=${encodeURIComponent(serviceId)}`)
        .then(async res => {
          const data = await res.json();
          if (!res.ok) {
            const errorMessage =
              typeof data?.error === 'string' ? data.error : 'Failed to load Slack channels.';
            throw new Error(errorMessage);
          }
          return data;
        })
        .then(data => {
          if (data.channels) {
            setSlackChannels(data.channels);
          }
        })
        .catch(err => {
          const errorMessage = err instanceof Error ? err.message : String(err);
          setChannelsError(errorMessage);
          if (err instanceof Error) {
            logger.error('Failed to fetch Slack channels', { error: err.message });
          } else {
            logger.error('Failed to fetch Slack channels', { error: String(err) });
          }
        })
        .finally(() => setLoadingChannels(false));
    }
  }, [slackIntegration, serviceId]);

  // Fetch existing Microsoft Teams destination + discovery when channel is toggled
  useEffect(() => {
    if (!channels.includes('MICROSOFT_TEAMS')) return;
    fetch(`/api/microsoft-teams/destinations?serviceId=${encodeURIComponent(serviceId)}`)
      .then(r => r.json())
      .then(d => {
        if (d?.data?.destination || d?.destination) {
          const dest = (d.data?.destination ?? d.destination) as typeof existingTeamsDest;
          if (dest) {
            setExistingTeamsDest(dest);
            if (dest.teamId) setSelectedTeamId(dest.teamId);
          }
        }
      })
      .catch(() => undefined);
    setTeamsLoading(true);
    setTeamsError(null);
    fetch(`/api/microsoft-teams/discovery/teams?serviceId=${encodeURIComponent(serviceId)}`)
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || data?.data?.error || 'Failed to load Teams');
        return data;
      })
      .then(data => {
        const list = (data.teams ?? data.data?.teams ?? []) as typeof teams;
        setTeams(list);
      })
      .catch(err => setTeamsError(err instanceof Error ? err.message : String(err)))
      .finally(() => setTeamsLoading(false));
  }, [channels, serviceId]);

  useEffect(() => {
    if (!selectedTeamId) {
      setTeamsChannels([]);
      return;
    }
    setTeamsChannelsLoading(true);
    setTeamsChannelsError(null);
    fetch(
      `/api/microsoft-teams/discovery/channels?teamId=${encodeURIComponent(selectedTeamId)}&serviceId=${encodeURIComponent(serviceId)}`
    )
      .then(async r => {
        const data = await r.json();
        if (!r.ok) throw new Error(data?.error || data?.data?.error || 'Failed to load channels');
        return data;
      })
      .then(data => {
        const list = (data.channels ?? data.data?.channels ?? []) as typeof teamsChannels;
        setTeamsChannels(list);
      })
      .catch(err => setTeamsChannelsError(err instanceof Error ? err.message : String(err)))
      .finally(() => setTeamsChannelsLoading(false));
  }, [selectedTeamId, serviceId]);

  const handleSlackChannelChange = (channelName: string) => {
    setSelectedSlackChannel(channelName);
    setJoinState({ status: 'idle', message: null, channelId: null });

    if (!channelName) return;

    const channel = slackChannels.find(ch => ch.name === channelName);
    if (!channel) return;

    // Just show status information - do NOT auto-join
    if (channel.isMember) {
      setJoinState({
        status: 'success',
        message: `OK: Bot is connected to #${channel.name}. Ready to send notifications.`,
        channelId: channel.id,
      });
    } else if (channel.isPrivate) {
      setJoinState({
        status: 'error',
        message: `Note: Bot is NOT connected to #${channel.name}. For private channels, invite the bot in Slack using: /invite @OpsKnight`,
        channelId: channel.id,
      });
    } else {
      setJoinState({
        status: 'error',
        message: `Note: Bot is NOT connected to #${channel.name}. Click "Connect Bot" below to add the bot to this channel.`,
        channelId: channel.id,
      });
    }
  };

  const handleConnectBot = async () => {
    const channel = slackChannels.find(ch => ch.name === selectedSlackChannel);
    if (!channel || channel.isMember || channel.isPrivate) return;

    setJoinState({
      status: 'joining',
      message: `Connecting bot to #${channel.name}...`,
      channelId: channel.id,
    });

    try {
      const response = await fetch('/api/slack/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channel.id, serviceId }),
      });

      const data = await response.json();
      if (!response.ok) {
        const errorCode = typeof data?.error === 'string' ? data.error : 'unknown_error';
        const friendlyMessage =
          errorCode === 'missing_scope'
            ? 'Missing Slack scope: channels:join. Update scopes and reconnect the Slack app.'
            : errorCode === 'not_allowed' || errorCode === 'restricted_action'
              ? 'Slack blocked this action. Check app permissions and try again.'
              : errorCode === 'not_in_channel'
                ? 'Bot must be invited for private channels.'
                : 'Failed to add bot to channel.';

        setJoinState({
          status: 'error',
          message: friendlyMessage,
          channelId: channel.id,
        });
        return;
      }

      setSlackChannels(prev =>
        prev.map(ch => (ch.id === channel.id ? { ...ch, isMember: true } : ch))
      );
      setJoinState({
        status: 'success',
        message: `OK: Bot connected to #${channel.name}. Ready to send notifications.`,
        channelId: channel.id,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to join Slack channel', { error: errorMessage });
      setJoinState({
        status: 'error',
        message: 'Failed to add bot to channel. Try again.',
        channelId: channel.id,
      });
    }
  };

  const memberCount = slackChannels.reduce(
    (count, channel) => count + (channel.isMember ? 1 : 0),
    0
  );

  return (
    <div className="space-y-6">
      {/* Top Banner Notice */}
      <Alert className="border border-primary/20 bg-primary/5 text-foreground rounded-2xl shadow-xs">
        <Info className="h-4 w-4 text-primary shrink-0" />
        <AlertTitle className="text-xs font-bold text-foreground">
          Service Notifications (Isolated)
        </AlertTitle>
        <AlertDescription className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
          Service notifications are isolated from individual responder escalation preferences. They
          broadcast incident state changes directly to configured team channels and automated
          webhook endpoints.
        </AlertDescription>
      </Alert>

      {/* FORM: Notification Channels and Event Triggers */}
      <form action={saveNotificationSettings} className="space-y-6">
        {/* Submit an explicit snapshot so an empty selection cannot be confused with a missing field. */}
        <input
          type="hidden"
          name="serviceNotificationChannelsJson"
          value={JSON.stringify(channels)}
        />
        {/* Hidden input for validation */}
        <input
          ref={selectRef}
          style={{ opacity: 0, height: 1, position: 'absolute' }}
          tabIndex={-1}
          required={channels.includes('SLACK')}
          value={channels.includes('SLACK') ? selectedSlackChannel || '' : ''}
          readOnly
          onChange={() => {}}
        />

        {/* CARD 1: Incident Event Triggers */}
        <Card className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs">
          <CardHeader className="pb-4 border-b border-border/60 bg-muted/20 dark:bg-muted/10">
            <CardTitle className="text-sm font-bold flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20 shadow-2xs">
                <BellRing className="h-4 w-4" />
              </div>
              <div>
                <span className="text-muted-foreground font-mono mr-1.5 text-xs">1.</span>
                <span>Incident Event Triggers</span>
              </div>
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Choose which incident lifecycle state transitions broadcast updates to configured
              notification channels.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <label
                htmlFor="notifyTriggered"
                className={cn(
                  'flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer',
                  notifyOnTriggered
                    ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20 shadow-2xs'
                    : 'border-border/80 bg-card hover:bg-muted/40 text-muted-foreground'
                )}
              >
                <Checkbox
                  id="notifyTriggered"
                  checked={notifyOnTriggered}
                  onCheckedChange={c => setNotifyOnTriggered(!!c)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-foreground">Incident Triggered</span>
                    <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      TRIGGERED
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                    Notify immediately when a new alert or incident is opened.
                  </p>
                </div>
              </label>

              <label
                htmlFor="notifyAck"
                className={cn(
                  'flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer',
                  notifyOnAck
                    ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20 shadow-2xs'
                    : 'border-border/80 bg-card hover:bg-muted/40 text-muted-foreground'
                )}
              >
                <Checkbox
                  id="notifyAck"
                  checked={notifyOnAck}
                  onCheckedChange={c => setNotifyOnAck(!!c)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-foreground">Incident Acknowledged</span>
                    <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                      ACKNOWLEDGED
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                    Notify when a responder claims ownership and acknowledges the incident.
                  </p>
                </div>
              </label>

              <label
                htmlFor="notifyResolved"
                className={cn(
                  'flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer',
                  notifyOnResolved
                    ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20 shadow-2xs'
                    : 'border-border/80 bg-card hover:bg-muted/40 text-muted-foreground'
                )}
              >
                <Checkbox
                  id="notifyResolved"
                  checked={notifyOnResolved}
                  onCheckedChange={c => setNotifyOnResolved(!!c)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-foreground">Incident Resolved</span>
                    <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      RESOLVED
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                    Notify when the incident is resolved and recovery has been verified.
                  </p>
                </div>
              </label>

              <label
                htmlFor="notifySla"
                className={cn(
                  'flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer',
                  notifyOnSlaBreach
                    ? 'border-destructive/40 bg-destructive/5 ring-1 ring-destructive/20 shadow-2xs'
                    : 'border-border/80 bg-card hover:bg-muted/40 text-muted-foreground'
                )}
              >
                <Checkbox
                  id="notifySla"
                  checked={notifyOnSlaBreach}
                  onCheckedChange={c => setNotifyOnSlaBreach(!!c)}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-bold text-foreground">SLA Breach Warning</span>
                    <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20">
                      SLA_BREACH
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                    Notify when acknowledgement or resolution targets breach configured SLA
                    deadlines.
                  </p>
                </div>
              </label>
            </div>

            {/* Hidden inputs for form submission */}
            <input
              type="hidden"
              name="serviceNotifyOnTriggered"
              value={String(notifyOnTriggered)}
            />
            <input type="hidden" name="serviceNotifyOnAck" value={String(notifyOnAck)} />
            <input type="hidden" name="serviceNotifyOnResolved" value={String(notifyOnResolved)} />
            <input
              type="hidden"
              name="serviceNotifyOnSlaBreach"
              value={String(notifyOnSlaBreach)}
            />
          </CardContent>
        </Card>

        {/* CARD 2: Team Chat Channels */}
        <Card className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs">
          <CardHeader className="pb-4 border-b border-border/60 bg-muted/20 dark:bg-muted/10">
            <CardTitle className="text-sm font-bold flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20 shadow-2xs">
                <MessageSquare className="h-4 w-4" />
              </div>
              <div>
                <span className="text-muted-foreground font-mono mr-1.5 text-xs">2.</span>
                <span>Team Chat Channels</span>
              </div>
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Route automated incident announcements directly into team chat channels in Slack or
              Microsoft Teams.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 space-y-6">
            {/* Active Chat Platforms Toggles */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-foreground">Notification Channels</Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {[
                  {
                    id: 'SLACK',
                    name: 'Slack',
                    icon: <SlackLogo className="h-4 w-4 shrink-0" />,
                    desc: 'Post incident cards to Slack channels',
                  },
                  {
                    id: 'MICROSOFT_TEAMS',
                    name: 'Microsoft Teams',
                    icon: <MicrosoftTeamsLogo className="h-4 w-4 shrink-0" />,
                    desc: 'Send Adaptive Cards to Teams channels',
                  },
                  {
                    id: 'WEBHOOK',
                    name: 'Outbound Webhooks',
                    icon: <Webhook className="h-4 w-4 shrink-0" />,
                    desc: 'Dispatch incident JSON to webhooks',
                  },
                ].map(item => {
                  const checked = channels.includes(item.id);
                  return (
                    <label
                      key={item.id}
                      htmlFor={`channel-${item.id}`}
                      className={cn(
                        'flex items-start gap-3 p-3.5 rounded-xl border text-left transition-all cursor-pointer',
                        checked
                          ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20 shadow-2xs'
                          : 'border-border/80 bg-card hover:bg-muted/40 text-muted-foreground'
                      )}
                    >
                      <Checkbox
                        id={`channel-${item.id}`}
                        checked={checked}
                        onCheckedChange={c => {
                          if (c) {
                            setChannels([...channels, item.id]);
                          } else {
                            setChannels(channels.filter(ch => ch !== item.id));
                          }
                        }}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {item.icon}
                          <span className="text-xs font-bold text-foreground">{item.name}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground leading-relaxed mt-1">
                          {item.desc}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Slack Config Section */}
            {channels.includes('SLACK') && (
              <div className="rounded-xl border border-border/80 bg-muted/10 p-4 space-y-4">
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-border/60">
                  <div className="flex items-center gap-2">
                    <SlackLogo className="h-4 w-4 shrink-0" />
                    <span className="text-xs font-bold text-foreground">
                      Slack Channel Configuration
                    </span>
                  </div>
                  {slackIntegration ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 inline-flex items-center gap-1">
                      <Check className="h-3 w-3" /> Connected (
                      {slackIntegration.workspaceName || 'Workspace'})
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                      Not Connected
                    </span>
                  )}
                </div>

                {!slackIntegration ? (
                  <Alert
                    variant="destructive"
                    className="bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40 text-amber-800 dark:text-amber-300"
                  >
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <AlertTitle className="text-xs font-semibold">
                      Slack is not connected yet
                    </AlertTitle>
                    <AlertDescription className="text-xs">
                      Ask an admin to connect Slack in{' '}
                      <Link
                        href="/settings/integrations/slack"
                        className="font-semibold underline hover:text-foreground"
                      >
                        Settings &rarr; Integrations &rarr; Slack
                      </Link>{' '}
                      to enable channel selection.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold text-foreground">
                        Select Channel for Notifications
                      </Label>
                      <span className="text-[11px] text-muted-foreground">
                        Bot has access to {memberCount} channel{memberCount === 1 ? '' : 's'}
                      </span>
                    </div>

                    <input type="hidden" name="slackChannel" value={selectedSlackChannel} />

                    {loadingChannels ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        Loading channels from Slack...
                      </div>
                    ) : channelsError ? (
                      <div className="text-xs text-destructive flex items-center gap-2">
                        <XCircle className="h-3.5 w-3.5" />
                        {channelsError}
                      </div>
                    ) : slackChannels.length === 0 ? (
                      <div className="text-xs text-muted-foreground">
                        No channels found. Check Slack scopes and ensure the workspace is connected.
                      </div>
                    ) : (
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <Select
                            value={selectedSlackChannel}
                            onValueChange={handleSlackChannelChange}
                            name="slackChannel"
                          >
                            <SelectTrigger className="w-full text-xs h-9">
                              <SelectValue placeholder="Choose a channel..." />
                            </SelectTrigger>
                            <SelectContent>
                              {slackChannels.map(ch => (
                                <SelectItem key={ch.id} value={ch.name}>
                                  <span className="flex items-center gap-2 text-xs">
                                    <span className="font-semibold">#{ch.name}</span>
                                    {ch.isPrivate && (
                                      <span className="text-[10px] text-muted-foreground">
                                        (private)
                                      </span>
                                    )}
                                    {ch.isMember && <Check className="h-3 w-3 text-emerald-500" />}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          onClick={refreshChannels}
                          disabled={loadingChannels}
                          title="Refresh channel list"
                        >
                          <RefreshCw
                            className={cn('h-3.5 w-3.5', loadingChannels && 'animate-spin')}
                          />
                        </Button>
                      </div>
                    )}

                    {joinState.status !== 'idle' && joinState.message && (
                      <Alert
                        className={cn(
                          'border text-xs py-2.5',
                          joinState.status === 'success'
                            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                            : joinState.status === 'error'
                              ? 'bg-destructive/10 border-destructive/30 text-destructive'
                              : 'bg-primary/10 border-primary/30 text-primary'
                        )}
                      >
                        <div className="flex items-start gap-2">
                          {joinState.status === 'success' ? (
                            <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          ) : joinState.status === 'error' ? (
                            <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          ) : (
                            <Loader2 className="h-3.5 w-3.5 animate-spin mt-0.5 shrink-0" />
                          )}
                          <div>{joinState.message}</div>
                        </div>
                      </Alert>
                    )}

                    <div className="flex flex-wrap gap-2 pt-1">
                      {selectedSlackChannel &&
                        (() => {
                          const channel = slackChannels.find(
                            ch => ch.name === selectedSlackChannel
                          );
                          if (channel && !channel.isMember && !channel.isPrivate) {
                            return (
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => void handleConnectBot()}
                                disabled={joinState.status === 'joining'}
                                className="text-xs h-8 bg-blue-600 hover:bg-blue-700"
                              >
                                {joinState.status === 'joining' && (
                                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                )}
                                Connect Bot to #{channel.name}
                              </Button>
                            );
                          }
                          return null;
                        })()}

                      {selectedSlackChannel &&
                        (() => {
                          const channel = slackChannels.find(
                            ch => ch.name === selectedSlackChannel
                          );
                          if (channel?.isMember) {
                            return (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => void handleTestNotification()}
                                disabled={testState.testing}
                                className={cn(
                                  'text-xs h-8',
                                  testState.result === 'success' &&
                                    'border-emerald-500 text-emerald-600 bg-emerald-500/10',
                                  testState.result === 'error' &&
                                    'border-destructive text-destructive bg-destructive/10'
                                )}
                              >
                                {testState.testing ? (
                                  <>
                                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                    Sending...
                                  </>
                                ) : testState.result === 'success' ? (
                                  <>
                                    <Check className="mr-1.5 h-3.5 w-3.5" />
                                    Test Sent!
                                  </>
                                ) : testState.result === 'error' ? (
                                  <>
                                    <XCircle className="mr-1.5 h-3.5 w-3.5" />
                                    Failed
                                  </>
                                ) : (
                                  <>
                                    <Send className="mr-1.5 h-3.5 w-3.5" />
                                    Send Test Message
                                  </>
                                )}
                              </Button>
                            );
                          }
                          return null;
                        })()}
                    </div>

                    <div className="pt-3 border-t border-border/60">
                      <Label
                        htmlFor="slackWebhookUrl"
                        className="text-xs font-semibold text-muted-foreground block mb-1"
                      >
                        Slack Webhook URL (Legacy Fallback)
                      </Label>
                      <input
                        id="slackWebhookUrl"
                        name="slackWebhookUrl"
                        defaultValue={slackWebhookUrl || ''}
                        placeholder="https://hooks.slack.com/services/..."
                        className="w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-xs font-mono shadow-xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Use this if you prefer static webhook URLs over OAuth app integration.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Microsoft Teams Section */}
            {channels.includes('MICROSOFT_TEAMS') && (
              <div className="rounded-xl border border-border/80 bg-muted/10 p-4 space-y-4">
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-border/60">
                  <div className="flex items-center gap-2">
                    <MicrosoftTeamsLogo className="h-4 w-4 shrink-0" />
                    <span className="text-xs font-bold text-foreground">
                      Microsoft Teams Destination
                    </span>
                  </div>
                  {existingTeamsDest ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 inline-flex items-center gap-1">
                      <Check className="h-3 w-3" /> Linked
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                      Unlinked
                    </span>
                  )}
                </div>

                <div className="text-xs text-muted-foreground leading-relaxed">
                  Teams is managed centrally for your tenant. Configure Azure credentials in{' '}
                  <Link
                    href="/settings/integrations/microsoft-teams"
                    className="text-primary font-semibold hover:underline"
                  >
                    Settings → Integrations → Microsoft Teams
                  </Link>
                  . After installing the bot to a Team/Channel, select the destination below.
                </div>

                {existingTeamsDest && (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 font-medium text-emerald-800 dark:text-emerald-300">
                      <Check className="h-4 w-4 shrink-0" />
                      <span>
                        Linked:{' '}
                        <strong>{existingTeamsDest.teamName ?? existingTeamsDest.teamId}</strong>{' '}
                        &rarr;{' '}
                        <strong>
                          {existingTeamsDest.channelName ?? existingTeamsDest.channelId}
                        </strong>
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={async () => {
                        await fetch(
                          `/api/microsoft-teams/destinations?serviceId=${encodeURIComponent(serviceId)}`,
                          { method: 'DELETE' }
                        );
                        setExistingTeamsDest(null);
                        setSelectedTeamId('');
                        setSelectedTeamsChannelId('');
                        setTeamsLinkResult({
                          status: 'success',
                          message: 'Teams destination unlinked.',
                        });
                        setTimeout(() => setTeamsLinkResult(null), 3000);
                      }}
                    >
                      Unlink
                    </Button>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold">Select Team</Label>
                    {teamsLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading Teams…
                      </div>
                    ) : teamsError ? (
                      <div className="text-xs text-destructive flex items-center gap-2">
                        <XCircle className="h-3.5 w-3.5" /> {teamsError}
                      </div>
                    ) : teams.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No Teams found. Ensure the app is installed to a Team.
                      </p>
                    ) : (
                      <Select
                        value={selectedTeamId}
                        onValueChange={v => {
                          setSelectedTeamId(v);
                          setSelectedTeamsChannelId('');
                        }}
                      >
                        <SelectTrigger className="text-xs h-9">
                          <SelectValue placeholder="Select a Team…" />
                        </SelectTrigger>
                        <SelectContent>
                          {teams.map(t => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.displayName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {selectedTeamId && (
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Select Channel</Label>
                      {teamsChannelsLoading ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading channels…
                        </div>
                      ) : teamsChannelsError ? (
                        <div className="text-xs text-destructive flex items-center gap-2">
                          <XCircle className="h-3.5 w-3.5" /> {teamsChannelsError}
                        </div>
                      ) : teamsChannels.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No channels in this Team.</p>
                      ) : (
                        <Select
                          value={selectedTeamsChannelId}
                          onValueChange={setSelectedTeamsChannelId}
                        >
                          <SelectTrigger className="text-xs h-9">
                            <SelectValue placeholder="Select a channel…" />
                          </SelectTrigger>
                          <SelectContent>
                            {teamsChannels.map(c => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.displayName ? `${c.displayName} — ${c.id.slice(0, 8)}…` : c.id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button
                      type="button"
                      size="sm"
                      className="text-xs h-8"
                      disabled={!selectedTeamId || !selectedTeamsChannelId || teamsLinking}
                      onClick={async () => {
                        setTeamsLinking(true);
                        setTeamsLinkResult(null);
                        try {
                          const teamName =
                            teams.find(t => t.id === selectedTeamId)?.displayName ?? null;
                          const channelName =
                            teamsChannels.find(c => c.id === selectedTeamsChannelId)?.displayName ??
                            null;
                          const inferredTenantId = existingTeamsDest?.tenantId?.trim();
                          const channelObj = teamsChannels.find(
                            c => c.id === selectedTeamsChannelId
                          );
                          const resolvedChannelId = channelObj?.id ?? selectedTeamsChannelId;
                          const payload: Record<string, unknown> = {
                            serviceId,
                            teamId: selectedTeamId,
                            channelId: resolvedChannelId,
                            channelName,
                            teamName,
                          };
                          if (inferredTenantId) payload.tenantId = inferredTenantId;
                          const res = await fetch('/api/microsoft-teams/destinations', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload),
                          });
                          const data = await res.json().catch(() => ({}));
                          if (!res.ok) {
                            const msg =
                              data?.error ||
                              data?.data?.error ||
                              'Failed to link Teams destination';
                            throw new Error(msg);
                          }
                          const dest = (data.destination ??
                            data.data?.destination) as typeof existingTeamsDest;
                          if (dest) setExistingTeamsDest(dest);
                          setTeamsLinkResult({
                            status: 'success',
                            message: 'Linked service to Teams channel.',
                          });
                        } catch (e) {
                          setTeamsLinkResult({
                            status: 'error',
                            message: e instanceof Error ? e.message : String(e),
                          });
                        } finally {
                          setTeamsLinking(false);
                          setTimeout(() => setTeamsLinkResult(null), 4000);
                        }
                      }}
                    >
                      {teamsLinking && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Link to Teams channel
                    </Button>
                    {existingTeamsDest && selectedTeamsChannelId && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-xs h-8"
                        disabled={teamsLinking}
                        onClick={async () => {
                          setTeamsLinking(true);
                          try {
                            const res = await fetch('/api/microsoft-teams/test', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ serviceId }),
                            });
                            const data = await res.json().catch(() => ({}));
                            if (!res.ok) throw new Error(data?.error || 'Test failed');
                            setTeamsLinkResult({
                              status: 'success',
                              message: 'Test Adaptive Card enqueued — check Teams.',
                            });
                          } catch (e) {
                            setTeamsLinkResult({
                              status: 'error',
                              message: e instanceof Error ? e.message : String(e),
                            });
                          } finally {
                            setTeamsLinking(false);
                            setTimeout(() => setTeamsLinkResult(null), 3500);
                          }
                        }}
                      >
                        <Send className="mr-1.5 h-3.5 w-3.5" /> Send Test
                      </Button>
                    )}
                  </div>

                  {teamsLinkResult && (
                    <Alert
                      className={cn(
                        'text-xs py-2',
                        teamsLinkResult.status === 'success'
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                          : 'border-destructive/30 bg-destructive/10 text-destructive'
                      )}
                    >
                      {teamsLinkResult.status === 'success' ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5" />
                      )}
                      <AlertDescription>{teamsLinkResult.message}</AlertDescription>
                    </Alert>
                  )}
                </div>
              </div>
            )}

            <div className="pt-2 flex justify-end border-t border-border/60">
              <Button type="submit" size="sm" className="text-xs">
                Save Notification Channels & Triggers
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* CARD 3 (Children, e.g. ChatOpsWarRoomSettings) */}
      {children}

      {/* CARD 4: Outbound Webhook Integrations */}
      <Card className="rounded-2xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs">
        <CardHeader className="pb-4 border-b border-border/60 bg-muted/20 dark:bg-muted/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-sm font-bold flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0 border border-primary/20 shadow-2xs">
                  <Webhook className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-muted-foreground font-mono mr-1.5 text-xs">4.</span>
                  <span>Outbound Webhook Integrations</span>
                </div>
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Deliver real-time incident JSON payloads to custom HTTP endpoints, automation
                workflows, or internal systems.
              </CardDescription>
            </div>
            <AddWebhookDialog serviceId={serviceId} />
          </div>
        </CardHeader>
        <CardContent className="p-5">
          {webhookIntegrations.length === 0 ? (
            <div className="text-xs text-muted-foreground italic text-center py-8 border border-dashed border-border/80 rounded-xl bg-muted/10">
              No webhook integrations configured for this service yet.
            </div>
          ) : (
            <div className="space-y-2.5">
              {webhookIntegrations.map(webhook => (
                <div
                  key={webhook.id}
                  className={cn(
                    'flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl border gap-3 transition-colors',
                    webhook.enabled
                      ? 'bg-card border-border/80 hover:bg-muted/20'
                      : 'bg-muted/20 border-border/50 opacity-75'
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-xs text-foreground flex items-center gap-2">
                      <span>{webhook.name}</span>
                      <span className="text-[10px] font-mono font-medium text-muted-foreground px-1.5 py-0.5 bg-muted rounded border border-border/60">
                        {webhook.type}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono mt-1 truncate max-w-xl">
                      {webhook.url}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={cn(
                        'text-[10px] font-semibold px-2 py-0.5 rounded-full border',
                        webhook.enabled
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                          : 'bg-muted text-muted-foreground border-border'
                      )}
                    >
                      {webhook.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <Link
                      href={`/services/${serviceId}/webhooks/${webhook.id}/edit`}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      Edit
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
