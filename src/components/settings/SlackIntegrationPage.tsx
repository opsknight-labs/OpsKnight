'use client';

import { useState, useEffect, useMemo } from 'react';
import { logger } from '@/lib/logger';
import { useRouter } from 'next/navigation';
import { notify as toast } from '@/lib/toast';

// Shadcn UI Components
import { Button } from '@/components/ui/shadcn/button';
import { Skeleton } from '@/components/ui/shadcn/skeleton';
import { Badge } from '@/components/ui/shadcn/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/shadcn/alert-dialog';

// Lucide Icons
import { AlertTriangle, ExternalLink, Hash, Copy, Check, RotateCcw, FileCode2 } from 'lucide-react';
import { SlackLogo } from '@/components/common/BrandLogos';

// Subcomponents
import {
  SlackChannelCard,
  SlackScopeList,
  SlackWorkspaceHeader,
  SlackChannelToolbar,
  SlackChannelToolbarSkeleton,
  type SlackChannel,
  type ChannelFilter,
} from '@/components/settings/slack';
import GuidedSlackSetup from '@/components/settings/GuidedSlackSetup';
import SlackSigningSecretCard from '@/components/settings/SlackSigningSecretCard';
import SlackManifestCard from '@/components/settings/SlackManifestCard';
import { getBaseUrl } from '@/lib/env-validation';
import { SLACK_REQUIRED_BOT_SCOPES, SLACK_OPTIONAL_BOT_SCOPES } from '@/lib/slack/app-manifest';

interface SlackIntegration {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  scopes: string[];
  installer?: {
    id: string;
    name: string | null;
    email: string;
  } | null;
}

interface SlackIntegrationPageProps {
  integration: SlackIntegration | null;
  isOAuthConfigured: boolean;
  isSigningSecretConfigured: boolean;
  isAdmin: boolean;
  appUrl?: string;
}

export default function SlackIntegrationPage({
  integration,
  isOAuthConfigured,
  isSigningSecretConfigured,
  isAdmin,
  appUrl,
}: SlackIntegrationPageProps) {
  const router = useRouter();
  const [channels, setChannels] = useState<SlackChannel[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<ChannelFilter>('all');
  const [channelsError, setChannelsError] = useState<string | null>(null);
  const [lastChannelsSync, setLastChannelsSync] = useState<Date | null>(null);
  const [visibleCount, setVisibleCount] = useState(50);
  const [joiningChannelId, setJoiningChannelId] = useState<string | null>(null);
  const [bulkConnecting, setBulkConnecting] = useState(false);
  const [testingChannelId, setTestingChannelId] = useState<string | null>(null);
  const [leavingChannelId, setLeavingChannelId] = useState<string | null>(null);
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    channelId: string;
    success: boolean;
    message: string;
  } | null>(null);

  const [confirmation, setConfirmation] = useState<{
    isOpen: boolean;
    title: string;
    description: string;
    action: () => Promise<void> | void;
    variant?: 'default' | 'destructive';
  }>({
    isOpen: false,
    title: '',
    description: '',
    action: () => {},
    variant: 'default',
  });

  const requiredScopes = useMemo(() => [...SLACK_REQUIRED_BOT_SCOPES], []);
  const optionalScopes = useMemo(() => [...SLACK_OPTIONAL_BOT_SCOPES], []);
  const scopeSet = useMemo(() => new Set(integration?.scopes ?? []), [integration]);
  const missingRequiredScopes = useMemo(
    () => requiredScopes.filter(scope => !scopeSet.has(scope)),
    [requiredScopes, scopeSet]
  );

  // Check if Slack was just connected (from URL param)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('slack_connected') === 'true') {
      toast.success('Successfully connected to Slack!', {
        description: 'You can now configure channels for your services.',
      });
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => router.refresh(), 500);
    }
  }, [router]);

  const getSlackChannelErrorMessage = (errorCode: string) => {
    const normalized = errorCode.toLowerCase();
    if (normalized === 'missing_scope') {
      return 'Slack scopes are missing. Add required scopes and reconnect the app.';
    }
    if (normalized === 'token_revoked' || normalized === 'invalid_auth') {
      return 'Slack token is invalid or revoked. Reconnect the app to refresh access.';
    }
    if (normalized === 'account_inactive') {
      return 'Slack workspace is inactive. Reactivate the workspace or reconnect.';
    }
    if (normalized === 'not_authed') {
      return 'Slack authorization failed. Reconnect the app to reauthorize.';
    }
    return `Slack error: ${errorCode.replace(/_/g, ' ')}`;
  };

  const loadChannels = async () => {
    if (!integration) return;
    setLoadingChannels(true);
    setChannelsError(null);
    try {
      const response = await fetch('/api/slack/channels');
      const data = await response.json();
      if (!response.ok) {
        const errorCode = typeof data?.error === 'string' ? data.error : null;
        const errorMessage = errorCode
          ? getSlackChannelErrorMessage(errorCode)
          : 'Failed to load Slack channels.';
        throw new Error(errorMessage);
      }
      if (data.channels) {
        setChannels(data.channels);
        setLastChannelsSync(new Date());
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setChannelsError(errorMessage);
      toast.error('Failed to load channels', { description: errorMessage });
      logger.error('Failed to fetch Slack channels', { error: errorMessage });
    } finally {
      setLoadingChannels(false);
    }
  };

  // Load channels when integration exists
  useEffect(() => {
    if (integration) {
      void loadChannels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [integration?.id]);

  const performDisconnect = async () => {
    try {
      const response = await fetch('/api/slack/disconnect', { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Failed to disconnect Slack. Try again.');
      }
      toast.success('Slack disconnected', { description: 'Integration has been removed.' });
      router.refresh();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error('Disconnect failed', { description: errorMessage });
    }
  };

  const handleOAuthRedirect = () => {
    window.location.assign(
      new URL(['/api', 'slack', 'oauth'].join('/'), window.location.origin).toString()
    );
  };

  const handleDisconnectClick = () => {
    setConfirmation({
      isOpen: true,
      title: 'Disconnect Slack integration?',
      description:
        'This will remove Slack notifications for all services. You can reconnect at any time.',
      variant: 'destructive',
      action: performDisconnect,
    });
  };

  const performReplaceWorkspace = async () => {
    try {
      const response = await fetch('/api/slack/disconnect', { method: 'DELETE' });
      if (!response.ok) {
        throw new Error('Failed to disconnect Slack. Try again.');
      }
      // Treat as a totally fresh connection: clear old credentials so wizard opens
      await fetch('/api/settings/slack-oauth', { method: 'DELETE' });
      window.location.reload();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error('Replace failed', { description: errorMessage });
    }
  };

  const handleReplaceWorkspaceClick = () => {
    setConfirmation({
      isOpen: true,
      title: 'Connect a different workspace?',
      description:
        'This will disconnect the current workspace and affect all services using it. You will be redirected to Slack to connect a new workspace.',
      variant: 'destructive',
      action: performReplaceWorkspace,
    });
  };

  useEffect(() => {
    setVisibleCount(50);
  }, [searchQuery, filter]);

  const handleJoinChannel = async (channel: SlackChannel) => {
    if (channel.isMember || channel.isPrivate || joiningChannelId) return;

    setJoiningChannelId(channel.id);

    try {
      const response = await fetch('/api/slack/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channel.id }),
      });

      const data = await response.json();
      if (!response.ok) {
        const errorCode = typeof data?.error === 'string' ? data.error : 'unknown_error';
        const friendlyMessage =
          errorCode === 'missing_scope'
            ? 'Missing Slack scope: channels:join. Reconnect the app with updated scopes.'
            : errorCode === 'channel_not_found'
              ? 'Channel not found. It may have been deleted.'
              : `Failed to join channel: ${errorCode}`;
        throw new Error(friendlyMessage);
      }

      setChannels(prev => prev.map(ch => (ch.id === channel.id ? { ...ch, isMember: true } : ch)));
      toast.success(`Joined #${channel.name}`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      toast.error('Failed to join channel', { description: errorMessage });
      logger.error('Failed to join Slack channel', { error: errorMessage, channelId: channel.id });
    } finally {
      setJoiningChannelId(null);
    }
  };

  const performLeaveChannel = async (channel: SlackChannel) => {
    setLeavingChannelId(channel.id);
    try {
      const response = await fetch('/api/slack/channels/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channelId: channel.id }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to leave channel');
      }
      setChannels(prev => prev.map(c => (c.id === channel.id ? { ...c, isMember: false } : c)));
      toast.success(`Left #${channel.name}`);
    } catch (err) {
      toast.error('Failed to leave channel', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setLeavingChannelId(null);
    }
  };

  const handleLeaveChannelClick = (channel: SlackChannel) => {
    setConfirmation({
      isOpen: true,
      title: `Leave #${channel.name}?`,
      description:
        'The bot will leave this channel and will no longer see messages or be able to send notifications to it.',
      variant: 'destructive',
      action: () => performLeaveChannel(channel),
    });
  };

  const handleTestChannel = async (channel: SlackChannel) => {
    setTestingChannelId(channel.id);
    setTestResult(null);
    try {
      const res = await fetch('/api/slack/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channelId: channel.id,
          channelName: channel.name,
        }),
      });
      const data = await res.json();
      const result = {
        channelId: channel.id,
        success: res.ok,
        message: res.ok ? 'Test sent!' : data.error || 'Failed',
      };
      setTestResult(result);
      if (res.ok) {
        toast.success('Test notification sent', { description: `Check #${channel.name} in Slack` });
      } else {
        toast.error('Test failed', {
          description: data.error || 'Failed to send test notification',
        });
      }
    } catch {
      setTestResult({
        channelId: channel.id,
        success: false,
        message: 'Network error',
      });
      toast.error('Test failed', { description: 'Network error' });
    } finally {
      setTestingChannelId(null);
      setTimeout(() => setTestResult(null), 3000);
    }
  };

  const handleBulkConnect = async () => {
    const publicDisconnected = channels.filter(ch => !ch.isMember && !ch.isPrivate);
    if (publicDisconnected.length === 0 || bulkConnecting) return;

    setBulkConnecting(true);
    let successCount = 0;

    for (const channel of publicDisconnected) {
      try {
        const response = await fetch('/api/slack/channels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ channelId: channel.id }),
        });

        if (response.ok) {
          setChannels(prev =>
            prev.map(ch => (ch.id === channel.id ? { ...ch, isMember: true } : ch))
          );
          successCount++;
        }
      } catch (_error) {
        logger.error('Bulk connect: failed to join channel', { channelId: channel.id });
      }
    }

    setBulkConnecting(false);
    toast.success(`Connected to ${successCount} channels`);
  };

  const channelSummary = useMemo(() => {
    const connected = channels.filter(ch => ch.isMember).length;
    const invite = channels.filter(ch => !ch.isMember && ch.isPrivate).length;
    const autoAdd = channels.filter(ch => !ch.isMember && !ch.isPrivate).length;
    return { total: channels.length, connected, invite, autoAdd };
  }, [channels]);

  const filteredChannels = useMemo(() => {
    const lowerQuery = searchQuery.toLowerCase();
    return channels.filter(ch => {
      const matchesSearch = !searchQuery || ch.name.toLowerCase().includes(lowerQuery);
      if (!matchesSearch) return false;
      if (filter === 'connected') return ch.isMember;
      if (filter === 'invite') return !ch.isMember && ch.isPrivate;
      if (filter === 'auto') return !ch.isMember && !ch.isPrivate;
      return true;
    });
  }, [channels, searchQuery, filter]);

  const visibleChannels = useMemo(() => {
    if (searchQuery) return filteredChannels;
    return filteredChannels.slice(0, visibleCount);
  }, [filteredChannels, searchQuery, visibleCount]);

  const clientOrigin = typeof window !== 'undefined' ? window.location.origin : '';
  const baseUrl =
    appUrl && appUrl !== 'http://localhost:3000'
      ? appUrl
      : clientOrigin && !clientOrigin.includes('localhost')
        ? clientOrigin
        : appUrl || getBaseUrl();
  const eventEndpoints = useMemo(
    () => [
      {
        name: 'Event Subscriptions URL',
        url: `${baseUrl}/api/slack/events`,
        desc: 'Subscribes bot to reaction_added (📌 pin-to-incident notes)',
      },
      {
        name: 'Interactivity Request URL',
        url: `${baseUrl}/api/slack/actions`,
        desc: 'Handles interactive buttons (Acknowledge, Escalate, Resolve)',
      },
      {
        name: 'Slash Command Request URL',
        url: `${baseUrl}/api/slack/commands`,
        desc: 'Executes /incident command from Slack channels',
      },
    ],
    [baseUrl]
  );

  const copyEndpoint = (url: string, key: string) => {
    void navigator.clipboard.writeText(url);
    setCopiedEndpoint(key);
    toast.success('URL copied to clipboard');
    setTimeout(() => setCopiedEndpoint(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* ───────────────────────────────────────────────────────────── */}
      {/* CASE 1: WORKSPACE IS CONNECTED                                */}
      {/* ───────────────────────────────────────────────────────────── */}
      {integration ? (
        <div className="space-y-6">
          {/* Card 1: Workspace Header & Identity */}
          <SlackWorkspaceHeader
            workspaceName={integration.workspaceName || 'Slack Workspace'}
            installerName={integration.installer?.name || 'Administrator'}
            updatedAt={integration.updatedAt}
            enabled={integration.enabled}
            isAdmin={isAdmin}
            onReconnect={handleOAuthRedirect}
            onReplaceWorkspace={handleReplaceWorkspaceClick}
          />

          {/* Missing Scopes Alert */}
          {missingRequiredScopes.length > 0 && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 sm:p-5 text-xs text-rose-800 dark:text-rose-300 space-y-3">
              <div className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0" />
                <span>Missing Slack scopes: {missingRequiredScopes.join(', ')}</span>
              </div>
              <p className="leading-relaxed">
                Slack only grants scopes that your app manifest requests. If you recently updated
                OpsKnight, apply the App Manifest below to your Slack app in the Slack API console,
                then reconnect the workspace to grant the new scopes.
              </p>
              {isAdmin && (
                <Button
                  size="sm"
                  variant="destructive"
                  asChild
                  className="h-8 text-xs font-semibold"
                >
                  <a href="/api/slack/oauth">Reconnect to refresh scopes</a>
                </Button>
              )}
            </div>
          )}

          {/* Card 2: Channel Discovery & Notifications */}
          <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
            {loadingChannels && channels.length === 0 ? (
              <>
                <SlackChannelToolbarSkeleton />
                <div className="space-y-2">
                  {[...Array(4)].map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-lg" />
                  ))}
                </div>
              </>
            ) : (
              <>
                <SlackChannelToolbar
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  filter={filter}
                  onFilterChange={setFilter}
                  summary={channelSummary}
                  isLoading={loadingChannels}
                  isBulkConnecting={bulkConnecting}
                  lastSyncTime={lastChannelsSync}
                  onRefresh={() => void loadChannels()}
                  onBulkConnect={() => void handleBulkConnect()}
                  scopeHealthy={missingRequiredScopes.length === 0}
                />

                {channelsError && channels.length === 0 ? (
                  <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-8 text-center space-y-3">
                    <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
                    <p className="font-semibold text-foreground text-sm">
                      Unable to load Slack channels
                    </p>
                    <p className="text-xs text-muted-foreground max-w-md mx-auto">
                      {channelsError}
                    </p>
                    {isAdmin && (
                      <div className="flex justify-center gap-2 pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void loadChannels()}
                          className="h-8 text-xs"
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                          Retry fetch
                        </Button>
                        <Button size="sm" asChild className="h-8 text-xs">
                          <a href="/api/slack/oauth">Reconnect Slack</a>
                        </Button>
                      </div>
                    )}
                  </div>
                ) : filteredChannels.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-10 text-center space-y-2">
                    <Hash className="h-8 w-8 text-muted-foreground mx-auto" />
                    <p className="font-semibold text-sm text-foreground">
                      {searchQuery ? 'No channels match your search' : 'No channels found'}
                    </p>
                    <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                      {searchQuery ? (
                        <>No channels match &quot;{searchQuery}&quot;. Try a different query.</>
                      ) : (
                        <>
                          Invite the bot to private channels using{' '}
                          <code className="bg-muted px-1 py-0.5 rounded font-mono">
                            /invite @OpsKnight
                          </code>
                          , or click &quot;Connect&quot; on public channels.
                        </>
                      )}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 pt-1">
                    {visibleChannels.map(ch => (
                      <SlackChannelCard
                        key={ch.id}
                        channel={ch}
                        onJoin={() => void handleJoinChannel(ch)}
                        onLeave={() => void handleLeaveChannelClick(ch)}
                        onTest={() => void handleTestChannel(ch)}
                        isJoining={joiningChannelId === ch.id}
                        isLeaving={leavingChannelId === ch.id}
                        isTesting={testingChannelId === ch.id}
                        testResult={testResult?.channelId === ch.id ? testResult : null}
                      />
                    ))}

                    {!searchQuery && filteredChannels.length > visibleCount && (
                      <div className="flex justify-center pt-3">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setVisibleCount(count => count + 50)}
                          className="h-8 text-xs font-semibold"
                        >
                          Show next {Math.min(50, filteredChannels.length - visibleCount)} channels
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Card 3: Scope Checklist & Permissions */}
          <SlackScopeList
            presentScopes={integration.scopes}
            requiredScopes={requiredScopes}
            optionalScopes={optionalScopes}
            isAdmin={isAdmin}
            onReconnect={handleOAuthRedirect}
          />

          {/* Card 4: App Credentials, Signing Secret & Manifest */}
          {isAdmin && (
            <div className="space-y-6">
              {/* Signing Secret Card */}
              <SlackSigningSecretCard isConfigured={isSigningSecretConfigured} />

              {/* App Manifest & Live Webhook URLs */}
              <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 shrink-0">
                      <FileCode2 className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-foreground">
                        App Manifest & Webhook URLs
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Copy pre-configured URLs and manifest for your Slack developer application.
                      </p>
                    </div>
                  </div>
                  <Button
                    asChild
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs font-semibold gap-1.5 self-start sm:self-auto"
                  >
                    <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer">
                      <span>Slack API Console</span>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                </div>

                {/* Reference Endpoints Grid */}
                <div className="grid gap-3 sm:grid-cols-3">
                  {eventEndpoints.map((ep, idx) => {
                    const isCopied = copiedEndpoint === `ep-${idx}`;
                    return (
                      <div
                        key={ep.name}
                        className="p-3.5 rounded-lg border bg-muted/20 flex flex-col justify-between gap-2.5"
                      >
                        <div className="space-y-1">
                          <span className="text-[11px] font-semibold text-foreground block">
                            {ep.name}
                          </span>
                          <p className="text-[10px] text-muted-foreground leading-snug">
                            {ep.desc}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 pt-1">
                          <code className="text-[10px] font-mono bg-background px-2 py-1 rounded border flex-1 truncate text-foreground">
                            {ep.url}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0 shrink-0"
                            onClick={() => copyEndpoint(ep.url, `ep-${idx}`)}
                            title="Copy URL"
                          >
                            {isCopied ? (
                              <Check className="h-3.5 w-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* App Manifest Viewer */}
                <SlackManifestCard baseUrl={baseUrl} />

                {/* Reset Credentials Action */}
                <div className="flex items-center justify-between pt-3 border-t text-xs">
                  <span className="text-muted-foreground">
                    Need to rotate Client ID or Client Secret?
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => {
                      setConfirmation({
                        isOpen: true,
                        title: 'Reset App Credentials?',
                        description:
                          'Are you sure you want to reset the Slack App configuration? This will clear your Client ID and Client Secret.',
                        variant: 'destructive',
                        action: async () => {
                          await fetch('/api/settings/slack-oauth', { method: 'DELETE' });
                          window.location.reload();
                        },
                      });
                    }}
                  >
                    Reset App Credentials
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Card 5: Danger Zone */}
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <h3 className="text-base font-semibold text-foreground">Danger Zone</h3>
                  <Badge variant="destructive" className="text-[9px] px-1.5 py-0">
                    Destructive
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 max-w-xl">
                  Disconnecting will remove OpsKnight&apos;s access to your Slack workspace and
                  disable incident notifications across all services.
                </p>
              </div>

              <Button
                variant="destructive"
                size="sm"
                onClick={handleDisconnectClick}
                className="h-8 text-xs font-semibold shrink-0 self-start sm:self-auto"
              >
                Disconnect Integration
              </Button>
            </div>
          </div>
        </div>
      ) : (
        /* ───────────────────────────────────────────────────────────── */
        /* CASE 2: WORKSPACE NOT CONNECTED                               */
        /* ───────────────────────────────────────────────────────────── */
        <div className="space-y-6">
          {/* Guided Setup Wizard (Admin Only when OAuth credentials not yet saved) */}
          {!isOAuthConfigured && isAdmin && <GuidedSlackSetup baseUrl={baseUrl} />}

          {/* Non-Admin Warning */}
          {!isOAuthConfigured && !isAdmin && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 flex items-start gap-3 text-xs text-destructive">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="font-semibold text-sm">Setup Required</p>
                <p className="text-muted-foreground leading-relaxed">
                  Slack integration needs to be configured by an administrator first. Please contact
                  your administrator to configure Slack OAuth credentials.
                </p>
              </div>
            </div>
          )}

          {/* Connect Workspace Hero Card */}
          <div className="rounded-xl border bg-card p-8 sm:p-12 text-center space-y-5 shadow-sm">
            <div className="flex justify-center">
              <div className="h-16 w-16 rounded-2xl bg-[#4A154B]/10 border border-[#4A154B]/20 flex items-center justify-center shadow-inner">
                <SlackLogo className="h-8 w-8" />
              </div>
            </div>

            <div className="space-y-2 max-w-md mx-auto">
              <h3 className="text-xl font-bold tracking-tight text-foreground">
                Connect Your Slack Workspace
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Connect Slack to receive real-time incident notifications, trigger automated slash
                commands, and triage directly from your team channels.
              </p>
            </div>

            {isOAuthConfigured ? (
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                <Button
                  size="lg"
                  asChild
                  className="gap-2 text-sm font-semibold h-11 px-6 shadow-md"
                >
                  <a href="/api/slack/oauth">
                    <SlackLogo className="h-4 w-4" />
                    <span>{isAdmin ? 'Connect to Slack' : 'Ask admin to connect'}</span>
                  </a>
                </Button>
                {isAdmin && (
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-11 px-5 text-xs font-semibold text-muted-foreground hover:text-foreground border-border/80"
                    onClick={() => {
                      setConfirmation({
                        isOpen: true,
                        title: 'Reset Slack App Credentials?',
                        description:
                          'Are you sure you want to reset the saved Slack App credentials? This will clear your Client ID and Client Secret so you can re-enter fresh credentials.',
                        variant: 'destructive',
                        action: async () => {
                          await fetch('/api/settings/slack-oauth', { method: 'DELETE' });
                          window.location.reload();
                        },
                      });
                    }}
                  >
                    Reset Credentials
                  </Button>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground pt-2">
                Slack OAuth must be configured first. Use the setup wizard above.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <AlertDialog
        open={confirmation.isOpen}
        onOpenChange={isOpen => setConfirmation(prev => ({ ...prev, isOpen }))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirmation.variant === 'destructive'
                  ? 'bg-destructive hover:bg-destructive/90 text-destructive-foreground'
                  : ''
              }
              onClick={async e => {
                e.preventDefault();
                await confirmation.action();
                setConfirmation(prev => ({ ...prev, isOpen: false }));
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
