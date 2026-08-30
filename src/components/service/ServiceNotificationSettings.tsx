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
  Slack,
  Webhook,
  Plus,
  Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import Link from 'next/link';
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

  // Ref for native validation (if using hidden native select for form submission)
  const selectRef = useRef<HTMLInputElement>(null);

  // Validation effect - adapted for custom select
  useEffect(() => {
    if (!selectRef.current) return;

    if (!selectedSlackChannel) {
      selectRef.current.setCustomValidity('');
      return;
    }

    const channel = slackChannels.find(ch => ch.name === selectedSlackChannel);
    if (channel && !channel.isMember) {
      selectRef.current.setCustomValidity('Bot must be connected to this channel before saving.');
    } else {
      selectRef.current.setCustomValidity('');
    }
  }, [selectedSlackChannel, slackChannels]);

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
        body: JSON.stringify({ channelId: channel.id, channelName: channel.name }),
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
    <form action={saveNotificationSettings} className="space-y-6">
      {/* Hidden input for validation */}
      <input
        ref={selectRef}
        style={{ opacity: 0, height: 1, position: 'absolute' }}
        tabIndex={-1}
        required={channels.includes('SLACK')}
        value={selectedSlackChannel || ''}
        readOnly
        // Adding onChange to avoid React warning about uncontrolled component since we set value
        onChange={() => {}}
      />

      <Alert className="bg-amber-50 border-amber-200 text-amber-800">
        <Info className="h-4 w-4 text-amber-600" />
        <AlertTitle className="text-amber-900 font-semibold mb-1">
          Service Notifications (Isolated)
        </AlertTitle>
        <AlertDescription className="text-amber-800">
          Service notifications are completely separate from escalation and user preferences. They
          use only the channels configured below and do NOT check user preferences.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Service Notification Channels</CardTitle>
          <CardDescription>
            Select which channels to use for service-level notifications. These are isolated from
            escalation notifications.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-wrap gap-4">
            {['SLACK', 'WEBHOOK'].map(channel => {
              const checked = channels.includes(channel);
              return (
                <div
                  key={channel}
                  className={cn(
                    'flex items-center space-x-2 border rounded-md px-4 py-3 transition-colors',
                    checked ? 'bg-primary/5 border-primary' : 'bg-white border-slate-200'
                  )}
                >
                  <Checkbox
                    id={`channel-${channel}`}
                    checked={checked}
                    onCheckedChange={c => {
                      if (c) {
                        setChannels([...channels, channel]);
                      } else {
                        setChannels(channels.filter(ch => ch !== channel));
                      }
                    }}
                    className="mr-2"
                  />
                  <Label
                    htmlFor={`channel-${channel}`}
                    className={cn(
                      'text-sm font-medium cursor-pointer flex-1',
                      checked ? 'text-primary' : 'text-slate-700'
                    )}
                  >
                    {channel}
                  </Label>

                  {/* Hidden input for form submission */}
                  <input
                    type="checkbox"
                    name="serviceNotificationChannels"
                    value={channel}
                    checked={checked}
                    readOnly
                    className="hidden"
                  />
                </div>
              );
            })}
          </div>

          <div className="border-t border-slate-100 pt-6">
            <Label className="text-base font-semibold mb-4 block">Notification Events</Label>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="notifyTriggered"
                  checked={notifyOnTriggered}
                  onCheckedChange={c => setNotifyOnTriggered(!!c)}
                />
                <Label htmlFor="notifyTriggered" className="font-normal cursor-pointer">
                  Notify when incident is <strong>TRIGGERED</strong>
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="notifyAck"
                  checked={notifyOnAck}
                  onCheckedChange={c => setNotifyOnAck(!!c)}
                />
                <Label htmlFor="notifyAck" className="font-normal cursor-pointer">
                  Notify when incident is <strong>ACKNOWLEDGED</strong>
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="notifyResolved"
                  checked={notifyOnResolved}
                  onCheckedChange={c => setNotifyOnResolved(!!c)}
                />
                <Label htmlFor="notifyResolved" className="font-normal cursor-pointer">
                  Notify when incident is <strong>RESOLVED</strong>
                </Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="notifySla"
                  checked={notifyOnSlaBreach}
                  onCheckedChange={c => setNotifyOnSlaBreach(!!c)}
                />
                <Label htmlFor="notifySla" className="font-normal cursor-pointer">
                  Notify on <strong>SLA BREACH</strong> (Warning)
                </Label>
              </div>
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
          </div>
        </CardContent>
      </Card>

      {/* Slack Integration */}
      {channels.includes('SLACK') && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Slack className="h-5 w-5" />
              Slack Integration
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="bg-slate-50 border border-slate-200 rounded-md p-4 text-sm text-slate-600">
              Slack is managed centrally for your workspace. Configure it in{' '}
              <Link
                href="/settings/integrations/slack"
                className="text-primary font-medium hover:underline"
              >
                Settings &rarr; Integrations &rarr; Slack
              </Link>
              .
            </div>

            {slackIntegration ? (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                  <Check className="h-4 w-4" />
                  Connected to {slackIntegration.workspaceName || 'Slack workspace'}
                </div>
                <div className="text-xs text-slate-500 ml-6">
                  Bot has access to {memberCount} channel{memberCount === 1 ? '' : 's'}. Public
                  channels can be auto-added when selected.
                </div>
              </div>
            ) : (
              <Alert
                variant="destructive"
                className="bg-orange-50 border-orange-200 text-orange-900"
              >
                <AlertTriangle className="h-4 w-4 text-orange-600" />
                <AlertTitle className="text-orange-900 font-medium">
                  Slack is not connected yet
                </AlertTitle>
                <AlertDescription className="text-orange-800">
                  Ask an admin to connect Slack in Settings &rarr; Integrations &rarr; Slack.
                </AlertDescription>
              </Alert>
            )}

            {/* Slack Channel Selector */}
            {slackIntegration && (
              <div className="space-y-3">
                <Label>Select Channel for Notifications</Label>
                <input type="hidden" name="slackChannel" value={selectedSlackChannel} />

                {loadingChannels ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500 p-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading channels from Slack...
                  </div>
                ) : channelsError ? (
                  <div className="text-sm text-red-500 flex items-center gap-2">
                    <XCircle className="h-4 w-4" />
                    {channelsError}
                  </div>
                ) : slackChannels.length === 0 ? (
                  <div className="text-sm text-slate-500">
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
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Choose a channel..." />
                        </SelectTrigger>
                        <SelectContent>
                          {slackChannels.map(ch => (
                            <SelectItem key={ch.id} value={ch.name}>
                              <span className="flex items-center gap-2">
                                <span className="font-medium">#{ch.name}</span>
                                {ch.isPrivate && (
                                  <span className="text-xs opacity-70">(private)</span>
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
                      onClick={refreshChannels}
                      disabled={loadingChannels}
                      title="Refresh channel list"
                    >
                      <RefreshCw className={cn('h-4 w-4', loadingChannels && 'animate-spin')} />
                    </Button>
                  </div>
                )}

                {/* Connection Status & Actions */}
                {joinState.status !== 'idle' && joinState.message && (
                  <Alert
                    className={cn(
                      'mt-3 border',
                      joinState.status === 'success'
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                        : joinState.status === 'error'
                          ? 'bg-red-50 border-red-200 text-red-800'
                          : 'bg-blue-50 border-blue-200 text-blue-800'
                    )}
                  >
                    <div className="flex items-start gap-2">
                      {joinState.status === 'success' ? (
                        <Check className="h-4 w-4 mt-0.5" />
                      ) : joinState.status === 'error' ? (
                        <AlertTriangle className="h-4 w-4 mt-0.5" />
                      ) : (
                        <Loader2 className="h-4 w-4 animate-spin mt-0.5" />
                      )}
                      <div className="text-sm">{joinState.message}</div>
                    </div>
                  </Alert>
                )}

                <div className="flex flex-wrap gap-2 pt-2">
                  {/* Connect Bot Button */}
                  {selectedSlackChannel &&
                    (() => {
                      const channel = slackChannels.find(ch => ch.name === selectedSlackChannel);
                      if (channel && !channel.isMember && !channel.isPrivate) {
                        return (
                          <Button
                            type="button"
                            onClick={() => void handleConnectBot()}
                            disabled={joinState.status === 'joining'}
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            {joinState.status === 'joining' && (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            )}
                            Connect Bot
                          </Button>
                        );
                      }
                      return null;
                    })()}

                  {/* Test Button */}
                  {selectedSlackChannel &&
                    (() => {
                      const channel = slackChannels.find(ch => ch.name === selectedSlackChannel);
                      if (channel?.isMember) {
                        return (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => void handleTestNotification()}
                            disabled={testState.testing}
                            className={cn(
                              testState.result === 'success' &&
                                'border-emerald-500 text-emerald-600 bg-emerald-50',
                              testState.result === 'error' &&
                                'border-red-500 text-red-600 bg-red-50'
                            )}
                          >
                            {testState.testing ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Sending...
                              </>
                            ) : testState.result === 'success' ? (
                              <>
                                <Check className="mr-2 h-4 w-4" />
                                Test Sent!
                              </>
                            ) : testState.result === 'error' ? (
                              <>
                                <XCircle className="mr-2 h-4 w-4" />
                                Failed
                              </>
                            ) : (
                              <>
                                <Send className="mr-2 h-4 w-4" />
                                Send Test
                              </>
                            )}
                          </Button>
                        );
                      }
                      return null;
                    })()}
                </div>
              </div>
            )}

            {/* Legacy Webhook URL (fallback) */}
            <div className="border-t pt-4">
              <Label className="mb-2 block">Slack Webhook URL (Legacy - Optional)</Label>
              <input
                name="slackWebhookUrl"
                defaultValue={slackWebhookUrl || ''}
                placeholder="https://hooks.slack.com/services/..."
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
              />
              <p className="text-xs text-slate-500 mt-1">
                Use this if you prefer webhook over OAuth integration
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Webhook Integrations */}
      {channels.includes('WEBHOOK') && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Webhook className="h-5 w-5" />
              Webhook Integrations
            </CardTitle>
            <Link
              href={`/services/${serviceId}/webhooks/new`}
              className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
                'bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2'
              )}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Webhook
            </Link>
          </CardHeader>
          <CardContent>
            {webhookIntegrations.length === 0 ? (
              <div className="text-sm text-slate-500 italic text-center py-6 border border-dashed rounded-md">
                No webhook integrations configured
              </div>
            ) : (
              <div className="space-y-3">
                {webhookIntegrations.map(webhook => (
                  <div
                    key={webhook.id}
                    className={cn(
                      'flex items-center justify-between p-3 rounded-md border',
                      webhook.enabled
                        ? 'bg-emerald-50/50 border-emerald-200'
                        : 'bg-red-50/50 border-red-200'
                    )}
                  >
                    <div>
                      <div className="font-medium text-sm flex items-center gap-2">
                        {webhook.name}
                        <span className="text-xs font-normal text-slate-500 px-2 py-0.5 bg-slate-100 rounded-full border border-slate-200">
                          {webhook.type}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-1 break-all">
                        {webhook.url}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          'text-xs font-medium px-2 py-0.5 rounded-full',
                          webhook.enabled
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-red-100 text-red-700'
                        )}
                      >
                        {webhook.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <Link
                        href={`/services/${serviceId}/webhooks/${webhook.id}/edit`}
                        className="text-xs font-medium text-slate-600 hover:text-primary underline"
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
      )}
      <div className="flex justify-end">
        <Button type="submit" size="sm">
          Save notification settings
        </Button>
      </div>
    </form>
  );
}
