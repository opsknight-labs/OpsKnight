'use client';

import { useState, useEffect, useMemo } from 'react';
import { logger } from '@/lib/logger';
import { useRouter } from 'next/navigation';
import { notify as toast } from '@/lib/toast';

// Shadcn UI Components
import { SettingsSection } from '@/components/settings/layout/SettingsSection';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/shadcn/alert';
import { Button } from '@/components/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/shadcn/card';
import { Skeleton } from '@/components/ui/shadcn/skeleton';

// Lucide Icons
import {
  AlertTriangle,
  Slack,
  Info,
  ExternalLink,
  Activity,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

// New Slack Components
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
}

export default function SlackIntegrationPage({
  integration,
  isOAuthConfigured,
  isSigningSecretConfigured,
  isAdmin,
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

  // Shared with the OAuth request and the generated app manifest, so the
  // checklist cannot claim a healthy install while the code asks for more.
  const requiredScopes = [...SLACK_REQUIRED_BOT_SCOPES];
  const optionalScopes = [...SLACK_OPTIONAL_BOT_SCOPES];
  const scopeSet = useMemo(() => new Set(integration?.scopes ?? []), [integration]);
  const missingRequiredScopes = requiredScopes.filter(scope => !scopeSet.has(scope));

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
      window.location.href = '/api/slack/oauth';
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

  // Compute integration status
  const integrationStatus = integration
    ? integration.enabled
      ? 'Connected'
      : 'Disabled'
    : 'Not Connected';
  const oauthStatus = isOAuthConfigured ? 'Configured' : 'Not Configured';
  const scopeStatus = integration && missingRequiredScopes.length === 0 ? 'Complete' : 'Incomplete';

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader>
          <div className="flex items-start gap-4">
            <div className="p-3 rounded-lg bg-primary/10">
              <Slack className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-2xl">Slack Integration</CardTitle>
              <CardDescription className="mt-2 text-base">
                Connect your Slack workspace to receive real-time incident notifications. Configure
                channels per service for targeted alerts and updates.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            {/* Scope Card */}
            <div className="p-4 rounded-lg border border-border bg-background">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Info className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Configuration</span>
                </div>
                <p className="font-semibold">
                  {integration ? integration.workspaceName || 'Connected' : 'Setup Required'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {integration
                    ? integration.installer?.name
                      ? `Connected by ${integration.installer.name}`
                      : 'Connected to workspace'
                    : 'Connect your Slack workspace to enable notifications'}
                </p>
              </div>
            </div>

            {/* Status Card */}
            <div className="p-4 rounded-lg border border-border bg-background">
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">Status</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">OAuth Config</span>
                    <Badge variant={isOAuthConfigured ? 'default' : 'secondary'}>
                      {oauthStatus}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Workspace</span>
                    <Badge
                      variant={
                        integration ? (integration.enabled ? 'default' : 'secondary') : 'secondary'
                      }
                    >
                      {integrationStatus}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Scopes</span>
                    <Badge
                      variant={
                        integration && missingRequiredScopes.length === 0 ? 'default' : 'secondary'
                      }
                    >
                      {scopeStatus}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* OAuth Configuration Section */}
      <SettingsSection
        title="OAuth Configuration"
        description="Configure Slack App credentials to enable workspace connection"
        action={
          <div className="flex gap-2">
            <Badge variant="outline">Admin Only</Badge>
            <Badge variant="outline">Required</Badge>
          </div>
        }
        footer={
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div>
              <p className="text-sm font-medium">Setup Instructions</p>
              <p className="text-sm text-muted-foreground">
                Create a Slack App, add OAuth scopes, and enter credentials to enable workspace
                connections.
              </p>
            </div>
          </div>
        }
      >
        {/* Guided Setup Wizard (Admin Only) */}
        {!isOAuthConfigured && isAdmin && <GuidedSlackSetup />}

        {/* Signing secret — the guided setup is hidden once Slack is connected,
            so an existing install needs somewhere to supply it */}
        {isOAuthConfigured && isAdmin && (
          <SlackSigningSecretCard isConfigured={isSigningSecretConfigured} />
        )}

        {/* Manifest stays available after setup: scopes and event subscriptions
            change as features land, and this is how an existing app catches up */}
        {isOAuthConfigured && isAdmin && (
          <div className="mb-4 rounded-lg border bg-background p-4">
            <SlackManifestCard baseUrl={getBaseUrl()} />
          </div>
        )}

        {/* Configuration Actions */}
        {isOAuthConfigured && isAdmin && (
          <div className="flex justify-end mb-4">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                setConfirmation({
                  isOpen: true,
                  title: 'Reset App Credentials?',
                  description:
                    'Are you sure you want to reset the Slack App configuration? This will require you to re-enter Client ID and Secret.',
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
        )}

        {/* Not Configured Warning (Non-Admin) */}
        {!isOAuthConfigured && !isAdmin && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Setup Required</AlertTitle>
            <AlertDescription>
              Slack integration needs to be configured by an administrator first. Please contact
              your admin to set up Slack OAuth credentials.
            </AlertDescription>
          </Alert>
        )}

        {!isOAuthConfigured && isAdmin && (
          <div className="flex justify-end">
            <Button asChild>
              <a href="https://api.slack.com/apps?new_app=1" target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Create Slack App
              </a>
            </Button>
          </div>
        )}
      </SettingsSection>

      {/* Workspace Connection Section */}
      <SettingsSection
        title="Workspace Connection"
        description="Connect and manage your Slack workspace integration"
        action={
          <div className="flex gap-2">
            <Badge variant="outline">Notifications</Badge>
            <Badge variant="outline">Real-time</Badge>
          </div>
        }
        footer={
          integration && (
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div>
                <p className="text-sm font-medium">Channel Management</p>
                <p className="text-sm text-muted-foreground">
                  Configure which channels receive notifications in the service-specific settings.
                </p>
              </div>
            </div>
          )
        }
      >
        <div className="space-y-6">
          {integration ? (
            <>
              {/* Workspace Header */}
              <SlackWorkspaceHeader
                workspaceName={integration.workspaceName || 'Slack Workspace'}
                installerName={integration.installer?.name || 'Administrator'}
                updatedAt={integration.updatedAt}
                enabled={integration.enabled}
                isAdmin={isAdmin}
                onReconnect={() => {
                  window.location.href = '/api/slack/oauth';
                }}
                onReplaceWorkspace={handleReplaceWorkspaceClick}
              />

              {/* Missing Scopes Alert */}
              {missingRequiredScopes.length > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertTitle>Missing Slack scopes</AlertTitle>
                  <AlertDescription className="space-y-2">
                    <p>
                      Not granted to this workspace:{' '}
                      <strong>{missingRequiredScopes.join(', ')}</strong>
                    </p>
                    <p className="text-xs">
                      Reconnecting alone will not add them — Slack only grants scopes the app itself
                      declares. Apply the App Manifest below first, then reinstall.
                    </p>
                    {isAdmin && (
                      <Button size="sm" asChild>
                        <a href="/api/slack/oauth">Reconnect to refresh scopes</a>
                      </Button>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {/* Scope Checklist */}
              <Card>
                <SlackScopeList
                  presentScopes={integration.scopes}
                  requiredScopes={requiredScopes}
                  optionalScopes={optionalScopes}
                  isAdmin={isAdmin}
                  onReconnect={() => {
                    window.location.href = '/api/slack/oauth';
                  }}
                />
              </Card>

              {/* Available Channels Section */}
              <div className="space-y-4">
                {loadingChannels && channels.length === 0 ? (
                  <>
                    <SlackChannelToolbarSkeleton />
                    <div className="space-y-2">
                      {[...Array(5)].map((_, i) => (
                        <Skeleton key={i} className="h-16 w-full rounded-lg" />
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
                      <Card className="border-destructive/50 bg-destructive/5">
                        <CardContent className="p-6 text-center space-y-3">
                          <AlertTriangle className="h-10 w-10 text-destructive mx-auto" />
                          <p className="font-medium">Unable to load channels</p>
                          <p className="text-sm text-muted-foreground">{channelsError}</p>
                          {isAdmin && (
                            <div className="flex justify-center gap-2 pt-2">
                              <Button variant="outline" onClick={() => void loadChannels()}>
                                Retry fetch
                              </Button>
                              <Button asChild>
                                <a href="/api/slack/oauth">Reconnect Slack</a>
                              </Button>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ) : filteredChannels.length === 0 ? (
                      <Card className="border-dashed">
                        <CardContent className="p-8 text-center">
                          <Info className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                          <p className="font-medium">
                            {searchQuery ? 'No channels match your search' : 'No channels found'}
                          </p>
                          <p className="text-sm text-muted-foreground mt-1">
                            {searchQuery ? (
                              <>
                                No channels match &quot;{searchQuery}&quot;. Try a different search
                                term.
                              </>
                            ) : (
                              <>
                                Invite the bot to private channels or select a public channel in
                                service settings to auto-add.
                              </>
                            )}
                          </p>
                        </CardContent>
                      </Card>
                    ) : (
                      <div className="space-y-2">
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
                          <div className="flex justify-center pt-4">
                            <Button
                              variant="outline"
                              onClick={() => setVisibleCount(count => count + 50)}
                            >
                              Show next {Math.min(50, filteredChannels.length - visibleCount)}
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                      Private channels require{' '}
                      <code className="bg-muted px-1 py-0.5 rounded">groups:read</code> and inviting
                      the bot.
                    </p>
                  </>
                )}
              </div>
            </>
          ) : (
            <Card className="border-dashed">
              <CardContent className="p-12 text-center space-y-4">
                <div className="flex justify-center">
                  <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
                    <Slack className="h-8 w-8 text-muted-foreground" />
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-semibold">Connect Your Slack Workspace</h3>
                  <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                    Connect Slack to receive incident notifications. You&apos;ll be able to choose
                    which channels to use for each service.
                  </p>
                </div>
                {isOAuthConfigured ? (
                  <Button size="lg" asChild>
                    <a href="/api/slack/oauth">
                      <Slack className="h-4 w-4 mr-2" />
                      {isAdmin ? 'Connect to Slack' : 'Ask admin to connect'}
                    </a>
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Slack OAuth must be configured first. Use the setup wizard above.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </SettingsSection>

      {/* Danger Zone */}
      {integration && (
        <SettingsSection
          title="Danger Zone"
          description="Disconnect Slack workspace and remove all notification configurations"
          action={<Badge variant="destructive">Destructive</Badge>}
          footer={
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Warning</AlertTitle>
              <AlertDescription>
                Disconnecting will remove OpsKnight&apos;s access to your Slack workspace and
                disable all incident notifications across all services.
              </AlertDescription>
            </Alert>
          }
        >
          <div className="py-4">
            <Button variant="destructive" onClick={handleDisconnectClick}>
              Disconnect Integration
            </Button>
          </div>
        </SettingsSection>
      )}

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
                  ? 'bg-destructive hover:bg-destructive/90'
                  : ''
              }
              onClick={async e => {
                e.preventDefault(); // Prevent auto close to handle async
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
