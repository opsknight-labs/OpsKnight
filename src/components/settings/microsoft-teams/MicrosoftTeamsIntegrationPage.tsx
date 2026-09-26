'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DetailTabs, { DetailTabContent } from '@/components/ui/DetailTabs';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
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
import { notify as toast } from '@/lib/toast';
import { MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import MicrosoftTeamsSetupWizard from './MicrosoftTeamsSetupWizard';
import WarRoomOperationsSection from './WarRoomOperationsSection';
import type {
  WarRoomOperationalSnapshot,
  IntegrationHealthSummary,
  OperationalHealth,
} from '@/lib/war-room/operations/types';
import {
  AlertTriangle,
  Hash,
  Activity,
  Clock3,
  Download,
  Trash2,
  Shield,
  ArrowUpRight,
  Sparkles,
  Layers,
  ShieldCheck,
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

export type MicrosoftTeamsIntegrationPageProps = {
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
  warRoomSnapshots?: WarRoomOperationalSnapshot[] | null;
  fleetSummary?: IntegrationHealthSummary | null;
  integrationReadiness?: OperationalHealth;
  operationalFleetHealth?: OperationalHealth;
  totalWarRooms?: number;
  warRoomCleanupPending?: number;
  rscState?: {
    unknown: boolean;
    missing: string[];
    error?: string | null;
  } | null;
  warRoomDiagnosticsError?: string | null;
};

export default function MicrosoftTeamsIntegrationPage({
  config,
  destinations,
  appManifestJson,
  isAdmin,
  health,
  installationCount,
  installationPermissions,
  warRoomSnapshots = [],
  fleetSummary = null,
  integrationReadiness = 'HEALTHY',
  operationalFleetHealth = 'HEALTHY',
  totalWarRooms = 0,
  warRoomCleanupPending = 0,
  rscState,
  warRoomDiagnosticsError,
}: MicrosoftTeamsIntegrationPageProps) {
  const router = useRouter();
  const [testing, setTesting] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [destinationSearch, setDestinationSearch] = useState('');

  const isConfigured = Boolean(config?.clientId && config?.enabled);
  const isInstalled = installationCount > 0;
  const isReady = isInstalled && destinations.some(destination => destination.enabled);

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

  const filteredDestinations = destinations.filter(d => {
    if (!destinationSearch.trim()) return true;
    const q = destinationSearch.toLowerCase().trim();
    return (
      (d.service?.name?.toLowerCase().includes(q) ?? false) ||
      (d.teamName?.toLowerCase().includes(q) ?? false) ||
      (d.channelName?.toLowerCase().includes(q) ?? false) ||
      d.channelId.toLowerCase().includes(q)
    );
  });

  const tabItems = [
    {
      id: 'setup',
      label: 'Setup & Credentials',
      icon: <Sparkles className="h-3.5 w-3.5" />,
      badge: isConfigured ? (
        <Badge
          variant="outline"
          className="border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px]"
        >
          Configured
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px]"
        >
          Required
        </Badge>
      ),
    },
    {
      id: 'destinations',
      label: 'Channel Routing',
      icon: <Hash className="h-3.5 w-3.5" />,
      count: destinations.length,
    },
    {
      id: 'war-rooms',
      label: 'War Room Operations',
      icon: <Layers className="h-3.5 w-3.5" />,
      count: totalWarRooms > 0 ? totalWarRooms : undefined,
      badge:
        warRoomCleanupPending > 0 ? (
          <Badge
            variant="outline"
            className="border-amber-300 text-amber-700 bg-amber-50 text-[10px]"
          >
            {warRoomCleanupPending} pending
          </Badge>
        ) : undefined,
    },
    {
      id: 'health',
      label: 'Health & Permissions',
      icon: <Activity className="h-3.5 w-3.5" />,
      badge: (
        <Badge
          variant="outline"
          className={`text-[10px] ${
            integrationReadiness === 'HEALTHY'
              ? 'border-emerald-300 text-emerald-700 bg-emerald-50'
              : integrationReadiness === 'UNKNOWN'
                ? 'border-blue-300 text-blue-700 bg-blue-50'
                : 'border-amber-300 text-amber-700 bg-amber-50'
          }`}
        >
          {integrationReadiness}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Top Level Summary Card */}
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
                    ? 'Bot installed in Teams · Link a channel destination in Channel Routing to begin routing'
                    : isConfigured
                      ? 'Credentials saved · Download and install the bot package in Teams'
                      : 'Configure your Azure AD App credentials in the Setup tab below'}
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

      {/* DetailTabs: Sub-page style top tabs */}
      <DetailTabs tabs={tabItems} defaultTab="setup" layout="grid">
        {/* SUB-PAGE 1: Setup & Guided Onboarding */}
        <DetailTabContent value="setup" className="space-y-6">
          <MicrosoftTeamsSetupWizard
            config={config}
            isAdmin={isAdmin}
            appManifestJson={appManifestJson}
            installationCount={installationCount}
            installationPermissions={installationPermissions}
            destinations={destinations}
          />
        </DetailTabContent>

        {/* SUB-PAGE 2: Channel Routing & Destinations */}
        <DetailTabContent value="destinations" className="space-y-4">
          <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold">Service Destinations</h3>
                <p className="text-xs text-muted-foreground">
                  Deliver incident cards and lifecycle updates directly into Microsoft Teams
                  channels.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative w-full sm:w-56">
                  <Input
                    placeholder="Filter destinations…"
                    value={destinationSearch}
                    onChange={e => setDestinationSearch(e.target.value)}
                    className="h-8 px-3 text-xs"
                  />
                </div>
                <Badge variant="outline" className="text-[10px] shrink-0">
                  {destinations.length} mapped
                </Badge>
              </div>
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
            ) : filteredDestinations.length === 0 ? (
              <div className="text-center py-6 text-xs text-muted-foreground">
                No destinations match &ldquo;{destinationSearch}&rdquo;.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredDestinations.map(d => (
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
                Want to link more services? Configure notification destinations directly in{' '}
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
        </DetailTabContent>

        {/* SUB-PAGE 3: War Room Operations (with 15-item pagination) */}
        <DetailTabContent value="war-rooms" className="space-y-4">
          {warRoomDiagnosticsError ? (
            <div
              className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
              role="alert"
            >
              <div className="font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> War-room diagnostics unavailable
              </div>
              <div className="mt-1 text-xs text-amber-800">
                Operational evidence could not be loaded — health is reported as UNKNOWN.{' '}
                {warRoomDiagnosticsError}
              </div>
            </div>
          ) : (
            <WarRoomOperationsSection
              snapshots={warRoomSnapshots ?? []}
              fleetSummary={fleetSummary}
            />
          )}
        </DetailTabContent>

        {/* SUB-PAGE 4: Health & Permissions */}
        <DetailTabContent value="health" className="space-y-4">
          {/* Integration Health Card */}
          <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" /> Integration Health Overview
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground font-medium">Readiness:</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] font-semibold ${
                    integrationReadiness === 'HEALTHY'
                      ? 'border-emerald-300 text-emerald-700 bg-emerald-50'
                      : integrationReadiness === 'UNKNOWN'
                        ? 'border-blue-300 text-blue-700 bg-blue-50'
                        : 'border-amber-300 text-amber-700 bg-amber-50'
                  }`}
                >
                  {integrationReadiness}
                </Badge>
                <span className="text-[11px] text-muted-foreground font-medium">Fleet:</span>
                <Badge
                  variant="outline"
                  className={`text-[10px] font-semibold ${
                    operationalFleetHealth === 'HEALTHY'
                      ? 'border-emerald-300 text-emerald-700 bg-emerald-50'
                      : operationalFleetHealth === 'DRIFTED'
                        ? 'border-violet-300 text-violet-700 bg-violet-50'
                        : 'border-amber-300 text-amber-700 bg-amber-50'
                  }`}
                >
                  {operationalFleetHealth}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-lg border bg-muted/20 space-y-1">
                <span className="text-[11px] text-muted-foreground">Bot Connector</span>
                <div className="font-semibold flex items-center gap-1.5">
                  <span
                    className={`h-2 w-2 rounded-full ${health?.botHealthy ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  />
                  {health?.botHealthy == null
                    ? 'Status Unknown'
                    : health.botHealthy
                      ? 'Healthy & Connected'
                      : 'Degraded / Missing'}
                </div>
              </div>

              <div className="p-3 rounded-lg border bg-muted/20 space-y-1">
                <span className="text-[11px] text-muted-foreground">Installations</span>
                <div className="font-semibold text-foreground">
                  {installationCount} Active Team(s)
                </div>
              </div>

              <div className="p-3 rounded-lg border bg-muted/20 space-y-1">
                <span className="text-[11px] text-muted-foreground">War Rooms</span>
                <div className="font-semibold text-foreground">
                  {totalWarRooms} Total
                  {warRoomCleanupPending > 0 ? ` (${warRoomCleanupPending} cleanup)` : ''}
                </div>
              </div>

              <div className="p-3 rounded-lg border bg-muted/20 space-y-1">
                <span className="text-[11px] text-muted-foreground">RSC Permissions</span>
                <div className="font-semibold text-foreground">
                  {rscState?.unknown
                    ? 'Unknown'
                    : rscState?.missing.length === 0
                      ? 'All Granted'
                      : `${rscState?.missing.length} Missing`}
                </div>
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
          </div>

          {/* Installations & Permissions List */}
          <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Installed Teams & Graph RSC Permissions</h3>
              <Badge variant="outline" className="text-[10px]">
                {installationPermissions.length} team(s)
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Per-installation correlation is preserved from Microsoft Graph. Each row shows
              destination count and last delivery status.
            </p>

            {installationPermissions.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                No active installations yet — complete Step 3 in the Setup tab to deploy the bot to
                your Team.
              </p>
            ) : (
              <div className="space-y-2">
                {installationPermissions.map(row => {
                  const delivery = health?.installations.find(i => i.teamId === row.teamId);
                  const healthyInst = !row.unknown && row.missing.length === 0;
                  return (
                    <div
                      key={row.teamId}
                      className="flex items-start justify-between gap-3 rounded-lg border p-3 bg-muted/10 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{row.teamName ?? row.teamId}</div>
                        <div className="truncate text-[11px] text-muted-foreground font-mono">
                          {row.teamId}
                        </div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {row.unknown
                            ? (row.error ?? 'Permission state unavailable')
                            : row.missing.length === 0
                              ? 'All RSC permissions granted'
                              : `Missing consent for: ${row.missing.join(', ')}`}
                        </div>
                        {delivery && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {delivery.enabled
                              ? `${delivery.destinationCount} destination(s)`
                              : 'Bot removed'}{' '}
                            {delivery.lastDeliveryAt
                              ? `· last ${delivery.lastDeliveryStatus} ${new Date(delivery.lastDeliveryAt).toLocaleString()}`
                              : '· no delivery history'}
                          </div>
                        )}
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          healthyInst
                            ? 'border-emerald-300 text-emerald-700 bg-emerald-50 text-[10px]'
                            : 'border-amber-300 text-amber-700 bg-amber-50 text-[10px]'
                        }
                      >
                        {healthyInst ? 'Healthy' : row.unknown ? 'Unknown' : 'Consent required'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Raw Diagnostics Drill-Down (No secrets) */}
          <details className="rounded-xl border bg-card p-4 shadow-sm text-xs">
            <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
              Drill down — raw diagnostic state (tokens redacted)
            </summary>
            <div className="mt-3 space-y-1.5 font-mono text-[11px] bg-muted/40 p-3 rounded-lg break-all">
              <div>
                clientId: {config?.clientId ? `${config.clientId.slice(0, 12)}…` : '—'} · tenantId:{' '}
                {config?.tenantId ?? '—'} · enabled: {String(config?.enabled ?? false)} ·
                warRoomsEnabled: {String(config?.warRoomsEnabled ?? false)}
              </div>
              <div>
                rscState:{' '}
                {rscState?.unknown
                  ? `unknown (${rscState?.error ?? 'pending install'})`
                  : `missing=[${rscState?.missing?.join(', ') ?? ''}]`}
              </div>
              <div>
                health: botHealthy={String(health?.botHealthy ?? 'unknown')} permissionsHealthy=
                {String(health?.permissionsHealthy ?? 'unknown')} lastSuccess=
                {health?.lastSuccessAt ?? '—'} lastError={health?.lastErrorCode ?? '—'}
              </div>
            </div>
          </details>
        </DetailTabContent>
      </DetailTabs>

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
