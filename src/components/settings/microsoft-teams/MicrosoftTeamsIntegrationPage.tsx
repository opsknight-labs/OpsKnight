'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/shadcn/tabs';
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
import { notify as toast } from '@/lib/toast';
import { MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import {
  Copy,
  Check,
  AlertTriangle,
  Hash,
  ExternalLink,
  Activity,
  Clock3,
  Download,
  Trash2,
  Settings2,
  FileCode2,
  Shield,
  Bot,
  ArrowUpRight,
} from 'lucide-react';

type DestinationRow = {
  id: string;
  serviceId: string;
  tenantId: string;
  teamId: string;
  channelId: string;
  channelName?: string | null;
  teamName?: string | null;
  enabled: boolean;
  interactiveEnabled: boolean;
  warRoomEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  service?: { name: string } | null;
};

type TeamsHealth = {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  botHealthy: boolean | null;
  permissionsHealthy: boolean | null;
  installations: Array<{
    teamId: string;
    teamName: string | null;
    enabled: boolean;
    destinationCount: number;
    lastDeliveryAt: string | null;
    lastDeliveryStatus: string | null;
    lastErrorMessage: string | null;
  }>;
} | null;

type InstallationPermissionState = {
  teamId: string;
  teamName: string | null;
  missing: string[];
  unknown: boolean;
  error?: string;
};

export default function MicrosoftTeamsIntegrationPage({
  config,
  destinations,
  appManifestJson,
  isAdmin,
  health,
  installationCount,
  installationPermissions,
}: {
  config: {
    id: string;
    clientId: string;
    tenantId?: string | null;
    tenantMode: string;
    enabled: boolean;
    interactiveEnabled: boolean;
    warRoomsEnabled: boolean;
    defaultMeetingOrganizerUpn?: string | null;
  } | null;
  destinations: DestinationRow[];
  appManifestJson: string;
  isAdmin: boolean;
  health?: TeamsHealth;
  installationCount: number;
  installationPermissions: InstallationPermissionState[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [showManifest, setShowManifest] = useState(false);

  const isConfigured = Boolean(config?.clientId && config?.enabled);
  const isInstalled = installationCount > 0;
  const isReady = isInstalled && destinations.some(destination => destination.enabled);

  const onSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isAdmin) return;
    const form = new FormData(e.currentTarget);
    setSaving(true);
    try {
      const { saveMicrosoftTeamsConfig } =
        await import('@/app/(app)/settings/integrations/microsoft-teams/actions');
      const result = await saveMicrosoftTeamsConfig(form);
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success('Microsoft Teams configuration saved.');
        router.refresh();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };

  const onTest = async (destinationId: string) => {
    setTesting(destinationId);
    try {
      const res = await fetch('/api/microsoft-teams/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ destinationId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) toast.success('Test Adaptive Card sent to Teams channel.');
      else toast.error(data?.error || 'Teams test failed');
    } catch {
      toast.error('Teams test failed');
    } finally {
      setTesting(null);
    }
  };

  const onToggleInteractive = async (destination: DestinationRow) => {
    const res = await fetch('/api/microsoft-teams/destinations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceId: destination.serviceId,
        destinationId: destination.id,
        interactiveEnabled: !destination.interactiveEnabled,
      }),
    });
    if (res.ok) {
      toast.success(
        `Interactive actions ${destination.interactiveEnabled ? 'disabled' : 'enabled'}.`
      );
      router.refresh();
    } else toast.error('Failed to update interactive actions.');
  };

  const onToggleWarRooms = async (destination: DestinationRow) => {
    const res = await fetch('/api/microsoft-teams/destinations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceId: destination.serviceId,
        destinationId: destination.id,
        warRoomEnabled: !destination.warRoomEnabled,
      }),
    });
    if (res.ok) {
      toast.success(`War room routing ${destination.warRoomEnabled ? 'disabled' : 'enabled'}.`);
      router.refresh();
    } else toast.error('Failed to update war room routing.');
  };

  const onDisconnect = async () => {
    setDisconnecting(true);
    try {
      const res = await fetch('/api/settings/microsoft-teams', { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || 'Failed to disconnect Microsoft Teams');
      }
      toast.success('Microsoft Teams disconnected', {
        description: 'Credentials and destinations have been removed.',
      });
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect Microsoft Teams');
    } finally {
      setDisconnecting(false);
      setConfirmDisconnect(false);
    }
  };

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(null), 1500);
  };

  const botEndpoint =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/microsoft-teams/messages`
      : '/api/microsoft-teams/messages';

  return (
    <div className="space-y-6">
      {/* Overview Status Card */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="h-12 w-12 rounded-xl bg-[#5B5BD6]/10 border border-[#5B5BD6]/20 flex items-center justify-center shrink-0">
              <MicrosoftTeamsLogo className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold">Microsoft Teams Workspace</h3>
                <Badge
                  variant="outline"
                  className={
                    isReady
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px]'
                      : isInstalled
                        ? 'border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[11px]'
                        : isConfigured
                          ? 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[11px]'
                          : 'border-muted text-muted-foreground text-[11px]'
                  }
                >
                  {isReady
                    ? 'Active & Linked'
                    : isInstalled
                      ? 'Bot Installed'
                      : isConfigured
                        ? 'Configured'
                        : 'Not Connected'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isReady
                  ? `${destinations.length} channel destination(s) active · Bot Connector ready`
                  : isInstalled
                    ? 'Bot installed to Teams · Link a channel destination below to begin routing'
                    : isConfigured
                      ? 'Credentials saved · Install the bot package into target Teams'
                      : 'Configure your Azure AD App credentials to enable Teams notifications & war rooms'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isConfigured && (
              <Button asChild variant="outline" size="sm" className="h-8 text-xs">
                <a href="/api/microsoft-teams/package">
                  <Download className="h-3.5 w-3.5 mr-1" />
                  Download App Package
                </a>
              </Button>
            )}
            {isAdmin && isConfigured && (
              <Button
                variant="destructive"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setConfirmDisconnect(true)}
                disabled={disconnecting}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                {disconnecting ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            )}
          </div>
        </div>

        {/* Quick telemetry strip */}
        <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t text-xs">
          <div>
            <span className="text-muted-foreground block text-[11px]">Tenant Mode</span>
            <span className="font-semibold text-foreground">
              {config?.tenantMode ?? 'SINGLE'} Tenant
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">Bot Delivery</span>
            <span className="font-semibold text-foreground">
              {health?.botHealthy ? (
                <span className="text-emerald-600 dark:text-emerald-400">● Healthy</span>
              ) : isInstalled ? (
                <span className="text-blue-600 dark:text-blue-400">● Installed</span>
              ) : (
                <span className="text-muted-foreground">○ Awaiting Install</span>
              )}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">Channel Routing</span>
            <span className="font-semibold text-foreground">
              {destinations.length > 0 ? `${destinations.length} Mapped` : '0 Destinations'}
            </span>
          </div>
          <div>
            <span className="text-muted-foreground block text-[11px]">Credentials</span>
            <span className="font-semibold text-foreground flex items-center gap-1">
              <Shield className="h-3 w-3 text-emerald-500" />
              AES-256 Encrypted
            </span>
          </div>
        </div>
      </div>

      {/* Tabs navigation */}
      <Tabs defaultValue="destinations" className="space-y-4">
        <TabsList className="bg-muted/60 p-1">
          <TabsTrigger value="destinations" className="text-xs">
            <Hash className="h-3.5 w-3.5 mr-1.5" />
            Channel Routing ({destinations.length})
          </TabsTrigger>
          <TabsTrigger value="credentials" className="text-xs">
            <Settings2 className="h-3.5 w-3.5 mr-1.5" />
            Azure Credentials
          </TabsTrigger>
          <TabsTrigger value="manifest" className="text-xs">
            <Bot className="h-3.5 w-3.5 mr-1.5" />
            Bot & Manifest
          </TabsTrigger>
          <TabsTrigger value="health" className="text-xs">
            <Activity className="h-3.5 w-3.5 mr-1.5" />
            Health & Readiness
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: Channel Routing & Destinations */}
        <TabsContent value="destinations" className="space-y-4">
          <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold">Service Destinations</h3>
                <p className="text-xs text-muted-foreground">
                  Deliver incident cards and lifecycle updates directly into Microsoft Teams
                  channels.
                </p>
              </div>
              <Badge variant="outline" className="text-[10px]">
                {destinations.length} mapped
              </Badge>
            </div>

            {destinations.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center space-y-3">
                <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center mx-auto text-muted-foreground">
                  <Hash className="h-5 w-5" />
                </div>
                <div className="max-w-md mx-auto">
                  <p className="text-sm font-medium">No channel destinations linked yet</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    To link a Teams channel: go to{' '}
                    <span className="font-semibold text-foreground">Services → [Your Service]</span>{' '}
                    → <span className="font-semibold text-foreground">Notifications</span> tab, and
                    select your Team and Channel under Microsoft Teams.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {destinations.map(d => (
                  <div
                    key={d.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border p-3.5 bg-muted/20 hover:bg-muted/30 transition-colors"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate">
                          {d.service?.name ?? d.serviceId}
                        </span>
                        <Badge
                          variant="secondary"
                          className="text-[10px] font-normal border bg-background"
                        >
                          {d.teamName ?? 'Team'}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <Hash className="h-3 w-3 text-muted-foreground/70" />
                        <span className="font-medium text-foreground">
                          {d.channelName ?? d.channelId}
                        </span>
                        <span className="text-muted-foreground/50">·</span>
                        <span>ChatOps: {d.interactiveEnabled ? 'Active' : 'Disabled'}</span>
                        <span className="text-muted-foreground/50">·</span>
                        <span>War Rooms: {d.warRoomEnabled ? 'Enabled' : 'Disabled'}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => onToggleWarRooms(d)}
                        disabled={!isAdmin || !config?.warRoomsEnabled}
                      >
                        {d.warRoomEnabled ? 'Disable War Rooms' : 'Enable War Rooms'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => onToggleInteractive(d)}
                        disabled={!isAdmin || !config?.interactiveEnabled}
                      >
                        {d.interactiveEnabled ? 'Disable actions' : 'Enable actions'}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 text-xs"
                        onClick={() => onTest(d.id)}
                        disabled={testing === d.id}
                      >
                        {testing === d.id ? 'Sending…' : 'Send Test'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground flex items-center justify-between gap-2">
              <span>
                💡 Want to link more services? Manage destinations directly in{' '}
                <strong>Service → Notifications</strong>.
              </span>
              <Link
                href="/services"
                className="inline-flex items-center text-primary hover:underline font-medium shrink-0"
              >
                View Services <ArrowUpRight className="h-3 w-3 ml-0.5" />
              </Link>
            </div>
          </div>
        </TabsContent>

        {/* TAB 2: Azure AD Credentials */}
        <TabsContent value="credentials" className="space-y-4">
          <form
            onSubmit={onSave}
            className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-5"
          >
            <div>
              <h3 className="text-sm font-semibold">Azure AD App Registration</h3>
              <p className="text-xs text-muted-foreground">
                Credentials from your Entra ID App Registration used for Microsoft Graph and Bot
                Connector authentication.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="mt-clientId" className="text-xs">
                  Application (Client) ID
                </Label>
                <Input
                  id="mt-clientId"
                  name="clientId"
                  placeholder="00000000-0000-0000-0000-000000000000"
                  defaultValue={config?.clientId ?? ''}
                  disabled={!isAdmin}
                  className="font-mono text-xs"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mt-clientSecret" className="text-xs">
                  Client Secret
                </Label>
                <Input
                  id="mt-clientSecret"
                  name="clientSecret"
                  type="password"
                  placeholder={config ? '•••••••• (leave blank to keep current)' : 'Client Secret'}
                  disabled={!isAdmin}
                  className="font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Encrypted at rest using AES-256-GCM. Never logged or exposed.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mt-tenantId" className="text-xs">
                  Directory (Tenant) ID
                </Label>
                <Input
                  id="mt-tenantId"
                  name="tenantId"
                  placeholder="Entra tenant GUID"
                  defaultValue={config?.tenantId ?? ''}
                  disabled={!isAdmin}
                  className="font-mono text-xs"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mt-tenantMode" className="text-xs">
                  Tenant Mode
                </Label>
                <select
                  id="mt-tenantMode"
                  name="tenantMode"
                  defaultValue="SINGLE"
                  disabled={!isAdmin}
                  className="h-9 w-full rounded-md border bg-background px-3 text-xs"
                >
                  <option value="SINGLE">SINGLE (Your Organization Only)</option>
                </select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="mt-defaultMeetingOrganizerUpn" className="text-xs">
                  Default Online Meeting Organizer (Email / UPN)
                </Label>
                <Input
                  id="mt-defaultMeetingOrganizerUpn"
                  name="defaultMeetingOrganizerUpn"
                  placeholder="incident-organizer@yourdomain.com"
                  defaultValue={config?.defaultMeetingOrganizerUpn ?? ''}
                  disabled={!isAdmin}
                  className="text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Used as the meeting organizer for automated Video Bridge war rooms when an
                  incident assignee does not have a linked Microsoft identity.
                </p>
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t">
              <label className="flex items-start gap-3 rounded-lg border p-3.5 text-xs hover:bg-muted/20 transition-colors cursor-pointer">
                <input
                  type="checkbox"
                  name="interactiveEnabled"
                  defaultChecked={config?.interactiveEnabled ?? false}
                  disabled={!isAdmin}
                  className="mt-0.5 rounded border-muted"
                />
                <div>
                  <span className="font-semibold text-foreground block">
                    Enable Interactive ChatOps Actions
                  </span>
                  <span className="text-muted-foreground block mt-0.5">
                    Allows responders to Acknowledge, Resolve, Add Notes, and Snooze directly from
                    Teams incident Adaptive Cards.
                  </span>
                </div>
              </label>

              <label className="flex items-start gap-3 rounded-lg border p-3.5 text-xs hover:bg-muted/20 transition-colors cursor-pointer">
                <input
                  type="checkbox"
                  name="warRoomsEnabled"
                  defaultChecked={config?.warRoomsEnabled ?? false}
                  disabled={!isAdmin}
                  className="mt-0.5 rounded border-muted"
                />
                <div>
                  <span className="font-semibold text-foreground block">
                    Enable Incident War Rooms
                  </span>
                  <span className="text-muted-foreground block mt-0.5">
                    Enables provisioning dedicated collaboration channels and Teams Video Bridges
                    for incidents.
                  </span>
                </div>
              </label>
            </div>

            {isAdmin && (
              <div className="flex justify-end pt-2">
                <Button type="submit" disabled={saving} className="h-9 text-xs font-semibold px-5">
                  {saving ? 'Saving…' : 'Save Configuration'}
                </Button>
              </div>
            )}
          </form>
        </TabsContent>

        {/* TAB 3: Bot Sideloading & Manifest */}
        <TabsContent value="manifest" className="space-y-4">
          <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-5">
            <div>
              <h3 className="text-sm font-semibold">Teams Bot & App Package</h3>
              <p className="text-xs text-muted-foreground">
                Install the OpsKnight app into your Microsoft Teams organization to enable
                bi-directional bot activities.
              </p>
            </div>

            {/* Messaging Endpoint Box */}
            <div className="rounded-lg border bg-muted/20 p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">Bot Messaging Endpoint</span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => copy(botEndpoint, 'endpoint')}
                >
                  {copied === 'endpoint' ? (
                    <Check className="h-3.5 w-3.5 mr-1" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 mr-1" />
                  )}
                  Copy Endpoint
                </Button>
              </div>
              <div className="font-mono text-xs p-2 rounded bg-background border truncate">
                {botEndpoint}
              </div>
              <p className="text-[11px] text-muted-foreground">
                Enter this URL in Azure Portal under{' '}
                <span className="font-semibold">
                  Azure Bot → Configuration → Messaging Endpoint
                </span>
                .
              </p>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-3">
              {isConfigured && (
                <Button asChild variant="default" size="sm" className="h-8 text-xs">
                  <a href="/api/microsoft-teams/package">
                    <Download className="h-3.5 w-3.5 mr-1.5" />
                    Download Teams App (.zip)
                  </a>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => copy(appManifestJson, 'manifest')}
              >
                {copied === 'manifest' ? (
                  <Check className="h-3.5 w-3.5 mr-1.5" />
                ) : (
                  <Copy className="h-3.5 w-3.5 mr-1.5" />
                )}
                Copy manifest.json
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => setShowManifest(!showManifest)}
              >
                <FileCode2 className="h-3.5 w-3.5 mr-1.5" />
                {showManifest ? 'Hide Manifest' : 'View Manifest JSON'}
              </Button>
              <a
                href="https://dev.teams.microsoft.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ml-auto"
              >
                Teams Developer Portal <ExternalLink className="h-3 w-3" />
              </a>
            </div>

            {showManifest && (
              <pre className="max-h-80 overflow-auto rounded-lg border bg-muted/40 p-3.5 text-[11px] font-mono leading-relaxed">
                {appManifestJson}
              </pre>
            )}
          </div>
        </TabsContent>

        {/* TAB 4: Health & Readiness */}
        <TabsContent value="health" className="space-y-4">
          <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold">Delivery Health & Permissions</h3>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg border p-3 bg-muted/20 space-y-1">
                <span className="text-muted-foreground block text-[11px]">Bot Connector</span>
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <span
                    className={`h-2 w-2 rounded-full ${health?.botHealthy ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  />
                  {health?.botHealthy == null
                    ? 'Status Unknown'
                    : health.botHealthy
                      ? 'Healthy & Connected'
                      : 'Not Installed / Degraded'}
                </span>
              </div>
              <div className="rounded-lg border p-3 bg-muted/20 space-y-1">
                <span className="text-muted-foreground block text-[11px]">Graph Permissions</span>
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <span
                    className={`h-2 w-2 rounded-full ${health?.permissionsHealthy ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  />
                  {health?.permissionsHealthy == null
                    ? 'Permissions Unknown'
                    : health.permissionsHealthy
                      ? 'Consented & Verified'
                      : 'Missing Consent'}
                </span>
              </div>
            </div>

            {health?.lastSuccessAt && (
              <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-xs text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                <Clock3 className="h-4 w-4 shrink-0" />
                <span>
                  Last successful delivery: {new Date(health.lastSuccessAt).toLocaleString()}
                </span>
              </div>
            )}

            {health?.lastErrorAt && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                <div className="font-semibold">
                  Last Provider Error: {health.lastErrorCode ?? 'UNKNOWN'}
                </div>
                <div className="text-muted-foreground break-words">
                  {health.lastErrorMessage ?? 'No details available.'}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {new Date(health.lastErrorAt).toLocaleString()}
                </div>
              </div>
            )}

            {installationPermissions.length > 0 && (
              <div className="space-y-2 pt-3 border-t">
                <h4 className="text-xs font-semibold">Installed Teams</h4>
                {installationPermissions.map(inst => (
                  <div
                    key={inst.teamId}
                    className="flex items-center justify-between p-2.5 rounded-lg border text-xs"
                  >
                    <div>
                      <span className="font-medium block">{inst.teamName ?? 'Team'}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {inst.teamId}
                      </span>
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {inst.unknown
                        ? 'Unknown'
                        : inst.missing.length === 0
                          ? 'Verified'
                          : 'Missing Consent'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Disconnect Confirmation Alert Dialog */}
      <AlertDialog open={confirmDisconnect} onOpenChange={setConfirmDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5 shrink-0" />
              Disconnect Microsoft Teams?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-relaxed">
              This will remove all Azure AD App credentials, delete installations, and wipe channel
              destinations across all services. In-flight war rooms will be safely settled. You can
              reconnect with fresh credentials at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={disconnecting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={e => {
                e.preventDefault();
                void onDisconnect();
              }}
              disabled={disconnecting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs"
            >
              {disconnecting ? 'Disconnecting…' : 'Yes, Disconnect Integration'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
