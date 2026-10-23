'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
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
  const [existingTeamsDests, setExistingTeamsDests] = useState<
    Array<{
      id: string;
      teamName: string | null;
      channelName: string | null;
      tenantId: string;
      teamId: string;
      channelId: string;
      warRoomEnabled?: boolean;
    }>
  >([]);

  // Slack multi-channel destinations
  const [existingSlackDests, setExistingSlackDests] = useState<
    Array<{
      id: string;
      channelId: string;
      channelName: string | null;
      isPrivate: boolean;
      enabled: boolean;
    }>
  >([]);
  const [slackLinking, setSlackLinking] = useState(false);
  const [slackLinkResult, setSlackLinkResult] = useState<{
    status: 'success' | 'error';
    message: string;
  } | null>(null);

  const refreshSlackDestinations = useCallback(() => {
    fetch(`/api/slack/destinations?serviceId=${encodeURIComponent(serviceId)}`)
      .then(r => r.json())
      .then(d => {
        const dests = (d?.data?.destinations ?? d?.destinations ?? []) as typeof existingSlackDests;
        if (Array.isArray(dests)) {
          setExistingSlackDests(dests);
        }
      })
      .catch(() => undefined);
  }, [serviceId]);

  useEffect(() => {
    if (channels.includes('SLACK') || slackIntegration) {
      refreshSlackDestinations();
    }
  }, [channels, slackIntegration, refreshSlackDestinations]);

  // Ref for native validation (if using hidden native select for form submission)
  const selectRef = useRef<HTMLInputElement>(null);

  // Validation effect - adapted for custom select
  useEffect(() => {
    if (!selectRef.current) return;

    if (!channels.includes('SLACK') || existingSlackDests.length > 0 || !selectedSlackChannel) {
      selectRef.current.setCustomValidity('');
      return;
    }

    const channel = slackChannels.find(ch => ch.name === selectedSlackChannel);
    if (channel && !channel.isMember && !channel.isPrivate) {
      selectRef.current.setCustomValidity('Bot must be connected to this channel before saving.');
    } else {
      selectRef.current.setCustomValidity('');
    }
  }, [selectedSlackChannel, slackChannels, channels, existingSlackDests.length]);

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

  // Fetch Slack channels when Slack is selected or integration exists
  useEffect(() => {
    if (slackIntegration) {
      queueMicrotask(() => {
        setLoadingChannels(true);
        setChannelsError(null);
      });
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

  // Fetch existing Microsoft Teams destinations + discovery when channel is toggled
  useEffect(() => {
    if (!channels.includes('MICROSOFT_TEAMS')) return;
    fetch(`/api/microsoft-teams/destinations?serviceId=${encodeURIComponent(serviceId)}`)
      .then(r => r.json())
      .then(d => {
        const dests = (d?.data?.destinations ??
          d?.destinations ??
          (d?.data?.destination
            ? [d.data.destination]
            : d?.destination
              ? [d.destination]
              : [])) as typeof existingTeamsDests;
        if (Array.isArray(dests)) {
          setExistingTeamsDests(dests);
          if (dests.length > 0 && dests[0].teamId) {
            setSelectedTeamId(current => current || dests[0].teamId);
          }
        }
      })
      .catch(() => undefined);
    queueMicrotask(() => {
      setTeamsLoading(true);
      setTeamsError(null);
    });
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
      queueMicrotask(() => {
        setTeamsChannels([]);
      });
      return;
    }
    queueMicrotask(() => {
      setTeamsChannelsLoading(true);
      setTeamsChannelsError(null);
    });
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

  const handleLinkSlackChannel = async (channelOverride?: {
    id: string;
    name: string;
    isPrivate: boolean;
  }) => {
    const target =
      channelOverride ??
      slackChannels.find(ch => ch.name === selectedSlackChannel || ch.id === selectedSlackChannel);
    if (!target) return;
    setSlackLinking(true);
    setSlackLinkResult(null);
    try {
      const res = await fetch('/api/slack/destinations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId,
          channelId: target.id,
          channelName: target.name,
          isPrivate: target.isPrivate,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(data?.error || data?.userMessage || 'Failed to link Slack channel');
      refreshSlackDestinations();
      setSelectedSlackChannel('');
      setJoinState({ status: 'idle', message: null, channelId: null });
      setSlackLinkResult({
        status: 'success',
        message: `Linked #${target.name} for notifications.`,
      });
    } catch (e) {
      setSlackLinkResult({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSlackLinking(false);
      setTimeout(() => setSlackLinkResult(null), 3500);
    }
  };

  const handleUnlinkSlackChannel = async (destId: string) => {
    setSlackLinking(true);
    try {
      const res = await fetch(
        `/api/slack/destinations?serviceId=${encodeURIComponent(serviceId)}&destinationId=${encodeURIComponent(destId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) throw new Error('Failed to unlink');
      refreshSlackDestinations();
      setSlackLinkResult({
        status: 'success',
        message: 'Slack channel unlinked.',
      });
    } catch (e) {
      setSlackLinkResult({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSlackLinking(false);
      setTimeout(() => setSlackLinkResult(null), 3000);
    }
  };

  const handleTestSlackDestination = async (dest: {
    id: string;
    channelId: string;
    channelName: string | null;
  }) => {
    setSlackLinking(true);
    try {
      const res = await fetch('/api/slack/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId,
          destinationId: dest.id,
          channelId: dest.channelId,
          channelName: dest.channelName,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Test notification failed');
      setSlackLinkResult({
        status: 'success',
        message: `Test message sent to #${dest.channelName ?? dest.channelId}.`,
      });
    } catch (e) {
      setSlackLinkResult({
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setSlackLinking(false);
      setTimeout(() => setSlackLinkResult(null), 3500);
    }
  };

  const memberCount = slackChannels.reduce(
    (count, channel) => count + (channel.isMember ? 1 : 0),
    0
  );

  return (
    <div className="space-y-3.5">
      {/* Top Banner Notice */}
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-primary/20 bg-primary/5 text-xs text-muted-foreground shadow-2xs">
        <Info className="h-4 w-4 text-primary shrink-0" />
        <div className="min-w-0">
          <span className="font-semibold text-foreground mr-1.5">
            Service Notifications (Isolated):
          </span>
          <span>
            Broadcast incident state changes directly to configured team channels and automated
            webhook endpoints without modifying responder escalation policies.
          </span>
        </div>
      </div>

      {/* FORM: Notification Channels and Event Triggers */}
      <form action={saveNotificationSettings} className="space-y-3.5">
        {/* Submit an explicit snapshot so an empty selection cannot be confused with a missing field. */}
        <input
          type="hidden"
          name="serviceNotificationChannelsJson"
          value={JSON.stringify(channels)}
        />
        <input
          type="hidden"
          name="slackChannel"
          value={
            existingSlackDests[0]?.channelName ||
            existingSlackDests[0]?.channelId ||
            selectedSlackChannel ||
            ''
          }
        />
        {/* Hidden input for validation */}
        <input
          ref={selectRef}
          style={{ opacity: 0, height: 1, position: 'absolute' }}
          tabIndex={-1}
          required={
            channels.includes('SLACK') &&
            existingSlackDests.length === 0 &&
            !slackWebhookUrl?.trim()
          }
          value={
            channels.includes('SLACK')
              ? existingSlackDests[0]?.channelName ||
                existingSlackDests[0]?.channelId ||
                selectedSlackChannel ||
                (slackWebhookUrl?.trim() ? 'webhook' : '')
              : ''
          }
          readOnly
          onChange={() => {}}
        />

        {/* CARD 1: Incident Event Triggers */}
        <Card className="rounded-xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs">
          <CardHeader className="py-2.5 px-3.5 border-b border-border/60 bg-muted/20 dark:bg-muted/10">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-xs font-bold flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0 border border-primary/20">
                  <BellRing className="h-3.5 w-3.5" />
                </div>
                <span>1. Incident Event Triggers</span>
              </CardTitle>
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/60">
                {
                  [notifyOnTriggered, notifyOnAck, notifyOnResolved, notifyOnSlaBreach].filter(
                    Boolean
                  ).length
                }
                /4 active
              </span>
            </div>
            <CardDescription className="text-[11px] text-muted-foreground mt-0.5">
              Choose which incident lifecycle state transitions broadcast updates to configured
              notification channels.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 sm:p-3.5">
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
              <label
                htmlFor="notifyTriggered"
                className={cn(
                  'min-w-0 flex items-center gap-2.5 p-2 px-2.5 rounded-lg border text-left transition-all cursor-pointer select-none',
                  notifyOnTriggered
                    ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20 shadow-2xs'
                    : 'border-border/80 bg-card hover:bg-muted/40 text-muted-foreground'
                )}
              >
                <Checkbox
                  id="notifyTriggered"
                  checked={notifyOnTriggered}
                  onCheckedChange={c => setNotifyOnTriggered(!!c)}
                  className="h-4 w-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <span className="text-xs font-semibold text-foreground truncate">
                      Incident Triggered
                    </span>
                    <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0">
                      TRIGGERED
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                    Notify immediately when a new alert or incident is opened.
                  </p>
                </div>
              </label>

              <label
                htmlFor="notifyAck"
                className={cn(
                  'min-w-0 flex items-center gap-2.5 p-2 px-2.5 rounded-lg border text-left transition-all cursor-pointer select-none',
                  notifyOnAck
                    ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20 shadow-2xs'
                    : 'border-border/80 bg-card hover:bg-muted/40 text-muted-foreground'
                )}
              >
                <Checkbox
                  id="notifyAck"
                  checked={notifyOnAck}
                  onCheckedChange={c => setNotifyOnAck(!!c)}
                  className="h-4 w-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <span className="text-xs font-semibold text-foreground truncate">
                      Incident Acknowledged
                    </span>
                    <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 shrink-0">
                      ACKNOWLEDGED
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                    Notify when a responder claims ownership and acknowledges the incident.
                  </p>
                </div>
              </label>

              <label
                htmlFor="notifyResolved"
                className={cn(
                  'min-w-0 flex items-center gap-2.5 p-2 px-2.5 rounded-lg border text-left transition-all cursor-pointer select-none',
                  notifyOnResolved
                    ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20 shadow-2xs'
                    : 'border-border/80 bg-card hover:bg-muted/40 text-muted-foreground'
                )}
              >
                <Checkbox
                  id="notifyResolved"
                  checked={notifyOnResolved}
                  onCheckedChange={c => setNotifyOnResolved(!!c)}
                  className="h-4 w-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <span className="text-xs font-semibold text-foreground truncate">
                      Incident Resolved
                    </span>
                    <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                      RESOLVED
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                    Notify when the incident is resolved and recovery has been verified.
                  </p>
                </div>
              </label>

              <label
                htmlFor="notifySla"
                className={cn(
                  'min-w-0 flex items-center gap-2.5 p-2 px-2.5 rounded-lg border text-left transition-all cursor-pointer select-none',
                  notifyOnSlaBreach
                    ? 'border-destructive/40 bg-destructive/5 ring-1 ring-destructive/20 shadow-2xs'
                    : 'border-border/80 bg-card hover:bg-muted/40 text-muted-foreground'
                )}
              >
                <Checkbox
                  id="notifySla"
                  checked={notifyOnSlaBreach}
                  onCheckedChange={c => setNotifyOnSlaBreach(!!c)}
                  className="h-4 w-4 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <span className="text-xs font-semibold text-foreground truncate">
                      SLA Breach Warning
                    </span>
                    <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20 shrink-0">
                      SLA_BREACH
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                    Notify when targets breach configured SLA deadlines.
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
        <Card className="rounded-xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs">
          <CardHeader className="py-2.5 px-3.5 border-b border-border/60 bg-muted/20 dark:bg-muted/10">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-xs font-bold flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0 border border-primary/20">
                  <MessageSquare className="h-3.5 w-3.5" />
                </div>
                <div>
                  <span className="text-muted-foreground font-mono mr-1 text-[11px]">2.</span>
                  <span>Team Chat Channels</span>
                </div>
              </CardTitle>
              <span className="text-[10px] font-mono font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border/60">
                {channels.length} channel type{channels.length === 1 ? '' : 's'} enabled
              </span>
            </div>
            <CardDescription className="text-[11px] text-muted-foreground mt-0.5">
              Route automated incident announcements directly into team chat channels in Slack or
              Microsoft Teams.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-3 sm:p-3.5 space-y-3">
            {/* Active Chat Platforms Toggles */}
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block">
                Notification Channels
              </Label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                {[
                  {
                    id: 'SLACK',
                    name: 'Slack',
                    icon: <SlackLogo className="h-3.5 w-3.5 shrink-0" />,
                    desc: 'Post cards to Slack channels',
                  },
                  {
                    id: 'MICROSOFT_TEAMS',
                    name: 'Microsoft Teams',
                    icon: <MicrosoftTeamsLogo className="h-3.5 w-3.5 shrink-0" />,
                    desc: 'Adaptive Cards to Teams channels',
                  },
                  {
                    id: 'WEBHOOK',
                    name: 'Outbound Webhooks',
                    icon: <Webhook className="h-3.5 w-3.5 shrink-0" />,
                    desc: 'Incident JSON to webhooks',
                  },
                ].map(item => {
                  const checked = channels.includes(item.id);
                  return (
                    <label
                      key={item.id}
                      htmlFor={`channel-${item.id}`}
                      className={cn(
                        'min-w-0 flex items-center gap-2 p-2 px-2.5 rounded-lg border text-left transition-all cursor-pointer select-none',
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
                        className="h-4 w-4 shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {item.icon}
                          <span className="text-xs font-semibold text-foreground">{item.name}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
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
              <div className="rounded-lg border border-border/80 bg-muted/10 p-2.5 sm:p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/60">
                  <div className="flex items-center gap-2">
                    <SlackLogo className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-xs font-bold text-foreground">Slack Destination</span>
                  </div>
                  {existingSlackDests.length > 0 ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 inline-flex items-center gap-1">
                      <Check className="h-3 w-3" /> Linked ({existingSlackDests.length}/3)
                    </span>
                  ) : slackIntegration ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                      Unlinked
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
                    className="bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40 text-amber-800 dark:text-amber-300 py-2"
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
                  <div className="space-y-2.5">
                    <div className="text-[11px] text-muted-foreground leading-normal">
                      Link up to 3 Slack channels to receive incident notification cards
                      simultaneously. Configure Slack workspace in{' '}
                      <Link
                        href="/settings/integrations/slack"
                        className="text-primary font-semibold hover:underline"
                      >
                        Settings &rarr; Integrations &rarr; Slack
                      </Link>
                      .
                    </div>

                    {existingSlackDests.length > 0 && (
                      <div className="space-y-1.5">
                        <Label className="text-[11px] font-semibold text-foreground">
                          Linked Channels ({existingSlackDests.length}/3)
                        </Label>
                        <div className="space-y-1.5">
                          {existingSlackDests.map(dest => (
                            <div
                              key={dest.id}
                              className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-xs flex items-center justify-between gap-2"
                            >
                              <div className="flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-300 min-w-0">
                                <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                                <span className="truncate text-xs">
                                  <strong>#{dest.channelName ?? dest.channelId}</strong>
                                </span>
                                {dest.isPrivate && (
                                  <span className="shrink-0 text-[10px] text-muted-foreground">
                                    (private)
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-2 text-[11px]"
                                  disabled={slackLinking}
                                  onClick={() => void handleTestSlackDestination(dest)}
                                >
                                  <Send className="mr-1 h-3 w-3" /> Test
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-2 text-[11px] text-destructive hover:bg-destructive/10"
                                  disabled={slackLinking}
                                  onClick={() => void handleUnlinkSlackChannel(dest.id)}
                                >
                                  Unlink
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {slackLinkResult && (
                      <div
                        className={cn(
                          'rounded-md px-2.5 py-1.5 text-xs border',
                          slackLinkResult.status === 'success'
                            ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                            : 'bg-destructive/10 border-destructive/30 text-destructive'
                        )}
                      >
                        {slackLinkResult.message}
                      </div>
                    )}

                    {existingSlackDests.length >= 3 ? (
                      <div className="rounded-lg border border-border/80 bg-muted/20 p-2 px-2.5 text-xs text-muted-foreground flex items-center gap-2">
                        <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                        <span>
                          Maximum limit reached (3 channels linked). Unlink a channel to connect
                          another.
                        </span>
                      </div>
                    ) : (
                      <div className="space-y-1.5 pt-1">
                        <div className="flex items-center justify-between">
                          <Label className="text-[11px] font-semibold text-foreground">
                            {existingSlackDests.length > 0
                              ? 'Link Another Channel'
                              : 'Select Channel for Notifications'}
                          </Label>
                          <span className="text-[10px] text-muted-foreground">
                            Bot has access to {memberCount} channel{memberCount === 1 ? '' : 's'}
                          </span>
                        </div>

                        {loadingChannels ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground p-1.5">
                            <Loader2 className="h-3 w-3 animate-spin text-primary" />
                            Loading channels from Slack...
                          </div>
                        ) : channelsError ? (
                          <div className="text-xs text-destructive flex items-center gap-1.5">
                            <XCircle className="h-3.5 w-3.5" />
                            {channelsError}
                          </div>
                        ) : slackChannels.length === 0 ? (
                          <div className="text-xs text-muted-foreground">
                            No channels found. Check Slack scopes and ensure the workspace is
                            connected.
                          </div>
                        ) : (
                          <div className="flex gap-2">
                            <div className="flex-1">
                              <Select
                                value={selectedSlackChannel}
                                onValueChange={handleSlackChannelChange}
                              >
                                <SelectTrigger className="w-full text-xs h-8">
                                  <SelectValue placeholder="Choose a channel..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {slackChannels.map(ch => {
                                    const isAlreadyLinked = existingSlackDests.some(
                                      d => d.channelId === ch.id || d.channelName === ch.name
                                    );
                                    return (
                                      <SelectItem
                                        key={ch.id}
                                        value={ch.name}
                                        disabled={isAlreadyLinked}
                                      >
                                        <span className="flex items-center gap-2 text-xs">
                                          <span className="font-semibold">#{ch.name}</span>
                                          {ch.isPrivate && (
                                            <span className="text-[10px] text-muted-foreground">
                                              (private)
                                            </span>
                                          )}
                                          {isAlreadyLinked ? (
                                            <span className="text-[10px] text-muted-foreground">
                                              (Already linked)
                                            </span>
                                          ) : ch.isMember ? (
                                            <Check className="h-3 w-3 text-emerald-500" />
                                          ) : null}
                                        </span>
                                      </SelectItem>
                                    );
                                  })}
                                </SelectContent>
                              </Select>
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 shrink-0"
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
                              'border text-xs py-2',
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

                        <div className="flex flex-wrap gap-2 pt-0.5">
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
                                    className="text-xs h-7 px-2.5 bg-blue-600 hover:bg-blue-700"
                                  >
                                    {joinState.status === 'joining' && (
                                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
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
                              const isAlreadyLinked = existingSlackDests.some(
                                d => d.channelId === channel?.id || d.channelName === channel?.name
                              );
                              if (channel && !isAlreadyLinked) {
                                return (
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => void handleLinkSlackChannel(channel)}
                                    disabled={
                                      slackLinking || (!channel.isMember && !channel.isPrivate)
                                    }
                                    className="text-xs h-7 px-2.5"
                                  >
                                    {slackLinking ? (
                                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                    ) : (
                                      <Check className="mr-1.5 h-3 w-3" />
                                    )}
                                    Link Channel
                                  </Button>
                                );
                              }
                              return null;
                            })()}
                        </div>
                      </div>
                    )}

                    <div className="pt-2 border-t border-border/60">
                      <div className="flex items-center justify-between mb-1">
                        <Label
                          htmlFor="slackWebhookUrl"
                          className="text-[11px] font-semibold text-muted-foreground"
                        >
                          Slack Webhook URL (Legacy Fallback)
                        </Label>
                        <span className="text-[10px] text-muted-foreground">Optional</span>
                      </div>
                      <input
                        id="slackWebhookUrl"
                        name="slackWebhookUrl"
                        defaultValue={slackWebhookUrl || ''}
                        placeholder="https://hooks.slack.com/services/..."
                        className="w-full h-8 rounded-md border border-input bg-background px-2.5 py-1 text-xs font-mono shadow-2xs focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Microsoft Teams Section */}
            {channels.includes('MICROSOFT_TEAMS') && (
              <div className="rounded-lg border border-border/80 bg-muted/10 p-2.5 sm:p-3 space-y-2.5">
                <div className="flex items-center justify-between gap-2 pb-2 border-b border-border/60">
                  <div className="flex items-center gap-2">
                    <MicrosoftTeamsLogo className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-xs font-bold text-foreground">
                      Microsoft Teams Destination
                    </span>
                  </div>
                  {existingTeamsDests.length > 0 ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 inline-flex items-center gap-1">
                      <Check className="h-3 w-3" /> Linked ({existingTeamsDests.length}/3)
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                      Unlinked
                    </span>
                  )}
                </div>

                <div className="text-[11px] text-muted-foreground leading-normal">
                  Teams is managed centrally for your tenant. Link up to 3 channels to receive
                  incident notification cards simultaneously. Incident War Rooms are hosted in the
                  primary channel.
                </div>

                {existingTeamsDests.length > 0 && (
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-semibold text-foreground">
                      Linked Channels ({existingTeamsDests.length}/3)
                    </Label>
                    <div className="space-y-1.5">
                      {existingTeamsDests.map(dest => (
                        <div
                          key={dest.id}
                          className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-1.5 text-xs flex items-center justify-between gap-2"
                        >
                          <div className="flex items-center gap-1.5 font-medium text-emerald-800 dark:text-emerald-300 min-w-0 flex-1">
                            <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                            <span className="truncate text-xs block min-w-0">
                              <strong>{dest.teamName ?? dest.teamId}</strong> &rarr;{' '}
                              <strong>{dest.channelName ?? dest.channelId}</strong>
                            </span>
                            {dest.warRoomEnabled && (
                              <span className="shrink-0 text-[9px] font-semibold px-1.5 py-0.2 rounded bg-primary/15 text-primary border border-primary/25">
                                War Room
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              disabled={teamsLinking}
                              onClick={async () => {
                                setTeamsLinking(true);
                                try {
                                  const res = await fetch('/api/microsoft-teams/test', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ destinationId: dest.id }),
                                  });
                                  const data = await res.json().catch(() => ({}));
                                  if (!res.ok) throw new Error(data?.error || 'Test failed');
                                  setTeamsLinkResult({
                                    status: 'success',
                                    message: `Test Adaptive Card sent to ${dest.channelName ?? 'channel'}.`,
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
                              <Send className="mr-1 h-3 w-3" /> Test
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-6 px-2 text-[11px] text-destructive hover:bg-destructive/10"
                              disabled={teamsLinking}
                              onClick={async () => {
                                setTeamsLinking(true);
                                try {
                                  await fetch(
                                    `/api/microsoft-teams/destinations?serviceId=${encodeURIComponent(serviceId)}&destinationId=${encodeURIComponent(dest.id)}`,
                                    { method: 'DELETE' }
                                  );
                                  const getRes = await fetch(
                                    `/api/microsoft-teams/destinations?serviceId=${encodeURIComponent(serviceId)}`
                                  );
                                  const getData = await getRes.json().catch(() => ({}));
                                  const nextDests = (getData?.data?.destinations ??
                                    getData?.destinations ??
                                    []) as typeof existingTeamsDests;
                                  setExistingTeamsDests(nextDests);
                                  setTeamsLinkResult({
                                    status: 'success',
                                    message: 'Teams channel unlinked.',
                                  });
                                } catch (e) {
                                  setTeamsLinkResult({
                                    status: 'error',
                                    message: e instanceof Error ? e.message : String(e),
                                  });
                                } finally {
                                  setTeamsLinking(false);
                                  setTimeout(() => setTeamsLinkResult(null), 3000);
                                }
                              }}
                            >
                              Unlink
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {existingTeamsDests.length >= 3 ? (
                  <div className="rounded-lg border border-border/80 bg-muted/20 p-2 px-2.5 text-xs text-muted-foreground flex items-center gap-2">
                    <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                    <span>
                      Maximum limit reached (3 channels linked). Unlink a channel to connect
                      another.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-2 pt-1">
                    <Label className="text-[11px] font-semibold text-foreground block">
                      {existingTeamsDests.length > 0
                        ? 'Link Another Channel'
                        : 'Link Teams Channel'}
                    </Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        {teamsLoading ? (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground h-8">
                            <Loader2 className="h-3 w-3 animate-spin" /> Loading Teams…
                          </div>
                        ) : teamsError ? (
                          <div className="text-xs text-destructive flex items-center gap-1.5 h-8">
                            <XCircle className="h-3 w-3" /> {teamsError}
                          </div>
                        ) : teams.length === 0 ? (
                          <p className="text-[11px] text-muted-foreground h-8 flex items-center">
                            No Teams found.
                          </p>
                        ) : (
                          <Select
                            value={selectedTeamId}
                            onValueChange={v => {
                              setSelectedTeamId(v);
                              setSelectedTeamsChannelId('');
                            }}
                          >
                            <SelectTrigger className="text-xs h-8">
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

                      <div>
                        {selectedTeamId ? (
                          teamsChannelsLoading ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground h-8">
                              <Loader2 className="h-3 w-3 animate-spin" /> Loading channels…
                            </div>
                          ) : teamsChannelsError ? (
                            <div className="text-xs text-destructive flex items-center gap-1.5 h-8">
                              <XCircle className="h-3 w-3" /> {teamsChannelsError}
                            </div>
                          ) : teamsChannels.length === 0 ? (
                            <p className="text-[11px] text-muted-foreground h-8 flex items-center">
                              No channels.
                            </p>
                          ) : (
                            <Select
                              value={selectedTeamsChannelId}
                              onValueChange={setSelectedTeamsChannelId}
                            >
                              <SelectTrigger className="text-xs h-8">
                                <SelectValue placeholder="Select a channel…" />
                              </SelectTrigger>
                              <SelectContent>
                                {teamsChannels.map(c => {
                                  const isAlreadyLinked = existingTeamsDests.some(
                                    d => d.teamId === selectedTeamId && d.channelId === c.id
                                  );
                                  return (
                                    <SelectItem key={c.id} value={c.id} disabled={isAlreadyLinked}>
                                      {c.displayName
                                        ? `${c.displayName} — ${c.id.slice(0, 8)}…`
                                        : c.id}
                                      {isAlreadyLinked ? ' (Already linked)' : ''}
                                    </SelectItem>
                                  );
                                })}
                              </SelectContent>
                            </Select>
                          )
                        ) : (
                          <div className="text-[11px] text-muted-foreground border border-dashed rounded-md h-8 px-2.5 flex items-center bg-muted/20">
                            Select a team first
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex justify-end pt-1">
                      <Button
                        type="button"
                        size="sm"
                        className="text-xs h-7 px-2.5"
                        disabled={
                          !selectedTeamId ||
                          !selectedTeamsChannelId ||
                          existingTeamsDests.some(
                            d =>
                              d.teamId === selectedTeamId && d.channelId === selectedTeamsChannelId
                          ) ||
                          teamsLinking
                        }
                        onClick={async () => {
                          setTeamsLinking(true);
                          setTeamsLinkResult(null);
                          try {
                            const teamName =
                              teams.find(t => t.id === selectedTeamId)?.displayName ?? null;
                            const channelName =
                              teamsChannels.find(c => c.id === selectedTeamsChannelId)
                                ?.displayName ?? null;
                            const inferredTenantId = existingTeamsDests[0]?.tenantId?.trim();
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
                              warRoomEnabled: existingTeamsDests.length === 0,
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
                            const getRes = await fetch(
                              `/api/microsoft-teams/destinations?serviceId=${encodeURIComponent(serviceId)}`
                            );
                            const getData = await getRes.json().catch(() => ({}));
                            const nextDests = (getData?.data?.destinations ??
                              getData?.destinations ??
                              []) as typeof existingTeamsDests;
                            setExistingTeamsDests(nextDests);
                            setSelectedTeamsChannelId('');
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
                        {teamsLinking && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                        Link Channel
                      </Button>
                    </div>
                  </div>
                )}

                {teamsLinkResult && (
                  <Alert
                    className={cn(
                      'text-xs py-1.5 px-2.5',
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
                    <AlertDescription className="text-xs">
                      {teamsLinkResult.message}
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            <div className="pt-2 flex justify-end border-t border-border/60">
              <Button type="submit" size="sm" className="text-xs h-8">
                Save Notification Channels & Triggers
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      {/* CARD 3 (Children, e.g. ChatOpsWarRoomSettings) */}
      {children}

      {/* CARD 4: Outbound Webhook Integrations */}
      <Card className="rounded-xl border border-border/80 dark:border-border/60 bg-card/90 dark:bg-card/60 backdrop-blur-xs shadow-xs">
        <CardHeader className="py-2.5 px-3.5 border-b border-border/60 bg-muted/20 dark:bg-muted/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-xs font-bold flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0 border border-primary/20">
                  <Webhook className="h-3.5 w-3.5" />
                </div>
                <div>
                  <span className="text-muted-foreground font-mono mr-1 text-[11px]">4.</span>
                  <span>Outbound Webhook Integrations</span>
                </div>
              </CardTitle>
              <CardDescription className="text-[11px] text-muted-foreground mt-0.5">
                Deliver real-time incident JSON payloads to custom HTTP endpoints, automation
                workflows, or internal systems.
              </CardDescription>
            </div>
            <AddWebhookDialog serviceId={serviceId} />
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-3.5">
          {webhookIntegrations.length === 0 ? (
            <div className="text-xs text-muted-foreground italic text-center py-4 border border-dashed border-border/80 rounded-lg bg-muted/10">
              No webhook integrations configured for this service yet.
            </div>
          ) : (
            <div className="space-y-2">
              {webhookIntegrations.map(webhook => (
                <div
                  key={webhook.id}
                  className={cn(
                    'flex flex-col sm:flex-row sm:items-center justify-between p-2.5 px-3 rounded-lg border gap-2 transition-colors',
                    webhook.enabled
                      ? 'bg-card border-border/80 hover:bg-muted/20'
                      : 'bg-muted/20 border-border/50 opacity-75'
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-xs text-foreground flex items-center gap-2">
                      <span>{webhook.name}</span>
                      <span className="text-[9px] font-mono font-medium text-muted-foreground px-1.5 py-0.2 bg-muted rounded border border-border/60">
                        {webhook.type}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate max-w-xl">
                      {webhook.url}
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5 shrink-0">
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
