'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { notify as toast } from '@/lib/toast';
import { MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import {
  Copy,
  Check,
  AlertTriangle,
  ShieldCheck,
  Hash,
  ExternalLink,
  Activity,
  Clock3,
  Download,
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

  const isConfigured = Boolean(config?.clientId);
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
      if (res.ok) toast.success('Test card sent to Teams channel.');
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

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-6">
      {/* State banner */}
      <div
        className={`rounded-xl border p-4 text-xs ${!isConfigured ? 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200' : !isInstalled || !isReady ? 'border-blue-500/30 bg-blue-500/10 text-blue-900 dark:text-blue-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'}`}
      >
        <div className="flex items-center gap-2 font-semibold">
          {!isConfigured ? (
            <AlertTriangle className="h-4 w-4" />
          ) : !isReady ? (
            <Hash className="h-4 w-4" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          <span>
            {!isConfigured
              ? 'Not configured — enter your Azure AD app credentials below.'
              : !isInstalled
                ? 'Credentials configured — awaiting a verified Teams installation.'
                : !isReady
                  ? 'Bot installed — map and enable a Service → Teams destination.'
                  : 'Ready — incident Adaptive Cards will post and update through the Bot Connector.'}
          </span>
        </div>
        <p className="mt-1 opacity-80">
          Use the global and per-destination controls below to govern Teams delivery and
          authenticated incident actions.
        </p>
      </div>

      {/* Configure card — console UI only, no .env */}
      <form onSubmit={onSave} className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#5B5BD6]/10 border border-[#5B5BD6]/20 flex items-center justify-center">
            <MicrosoftTeamsLogo className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Azure AD App Credentials</h3>
            <p className="text-xs text-muted-foreground">
              Stored encrypted in the database (AES-256-GCM). No secret in .env.
            </p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mt-clientId">Application (client) ID</Label>
            <Input
              id="mt-clientId"
              name="clientId"
              placeholder="00000000-0000-0000-0000-000000000000"
              defaultValue={config?.clientId ?? ''}
              disabled={!isAdmin}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mt-clientSecret">Client Secret</Label>
            <Input
              id="mt-clientSecret"
              name="clientSecret"
              type="password"
              placeholder={config ? '•••••••• (leave blank to keep)' : 'Client secret value'}
              disabled={!isAdmin}
            />
            <p className="text-[11px] text-muted-foreground">
              Value is encrypted at rest and never returned.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mt-tenantId">Tenant ID</Label>
            <Input
              id="mt-tenantId"
              name="tenantId"
              placeholder="Entra tenant GUID"
              defaultValue={config?.tenantId ?? ''}
              disabled={!isAdmin}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mt-tenantMode">Tenant Mode</Label>
            <select
              id="mt-tenantMode"
              name="tenantMode"
              defaultValue={config?.tenantMode ?? 'SINGLE'}
              disabled={!isAdmin}
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            >
              <option value="SINGLE">SINGLE</option>
            </select>
            <p className="text-[11px] text-muted-foreground">
              A verified single-tenant Bot authority keeps Teams routing and token acquisition
              scoped to your organization.
            </p>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="mt-defaultMeetingOrganizerUpn">
              Default Online Meeting Organizer (UPN / Email)
            </Label>
            <Input
              id="mt-defaultMeetingOrganizerUpn"
              name="defaultMeetingOrganizerUpn"
              placeholder="incident-organizer@yourdomain.com"
              defaultValue={config?.defaultMeetingOrganizerUpn ?? ''}
              disabled={!isAdmin}
            />
            <p className="text-[11px] text-muted-foreground">
              Optional fallback user principal name or email used as the organizer for Microsoft
              Teams online meetings when incident assignee or team lead does not have a linked
              Microsoft identity.
            </p>
          </div>
        </div>
        <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
          <input
            type="checkbox"
            name="interactiveEnabled"
            defaultChecked={config?.interactiveEnabled ?? false}
            disabled={!isAdmin}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Enable interactive incident actions</span>
            <span className="block text-xs text-muted-foreground">
              Global kill switch for authenticated Teams ChatOps. Each destination must also opt in.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
          <input
            type="checkbox"
            name="warRoomsEnabled"
            defaultChecked={config?.warRoomsEnabled ?? false}
            disabled={!isAdmin}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Enable incident war rooms</span>
            <span className="block text-xs text-muted-foreground">
              Requests the Teams channel, lifecycle, and member-management permissions required for
              managed war rooms. Re-download and re-consent the package in every target Team.
              Resolved rooms render a final disabled card, then close without archive escalation.
            </span>
          </span>
        </label>
        {isAdmin && (
          <Button type="submit" disabled={saving} className="h-9 text-xs font-semibold">
            {saving ? 'Saving…' : 'Save Teams Configuration'}
          </Button>
        )}
      </form>

      {/* Install guidance */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">Install & manifest</h3>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() =>
              copy(window.location.origin + '/api/microsoft-teams/messages', 'endpoint')
            }
          >
            {copied === 'endpoint' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span className="ml-1">Bot endpoint</span>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Card delivery uses Bot Connector credentials. When incident war rooms are enabled, this
          package requests the scoped channel, lifecycle, and membership permissions needed to
          create, synchronize, and close managed rooms. Download and re-consent it for each target
          Team.
        </p>
        <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/30 p-3 text-[11px] font-mono">
          {appManifestJson}
        </pre>
        <div className="flex gap-2">
          {isConfigured && (
            <Button asChild variant="default" size="sm" className="h-7 text-xs">
              <a href="/api/microsoft-teams/package">
                <Download className="h-3.5 w-3.5 mr-1" />
                Download Teams app
              </a>
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => copy(appManifestJson, 'manifest')}
          >
            {copied === 'manifest' ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            <span className="ml-1">Copy manifest</span>
          </Button>
          <a
            href="https://dev.teams.microsoft.com"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            Teams Developer Portal <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Service → Teams destination routing */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Service → Teams destinations</h3>
          <Badge variant="outline" className="text-[10px]">
            {destinations.length} mapped
          </Badge>
        </div>
        {destinations.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No service is mapped to a Teams channel yet. After installing the bot to a Team/Channel,
            map a service to `tenantId / teamId / channelId` from the Service settings or via the
            API.
          </p>
        ) : (
          <div className="space-y-2">
            {destinations.map(d => (
              <div key={d.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">
                    {d.service?.name ?? d.serviceId}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {(d.teamName ?? d.teamId) + ' → ' + (d.channelName ?? d.channelId)}
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Interactive actions: {d.interactiveEnabled ? 'ON' : 'OFF'}
                  </div>
                </div>
                <div className="ml-3 flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => onToggleInteractive(d)}
                    disabled={!isAdmin || !config?.interactiveEnabled}
                  >
                    {d.interactiveEnabled ? 'Disable actions' : 'Enable actions'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
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
        <p className="text-[11px] text-muted-foreground">
          Send Test posts an Adaptive Card through the same Bot Connector transport used by incident
          delivery.
        </p>
      </div>

      {/* Health: last delivery + bot/permissions pills (server-provided, not polling) */}
      {isConfigured && health && (
        <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Delivery health</h3>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge
              variant="outline"
              className={
                health.botHealthy
                  ? 'border-emerald-300 text-emerald-700'
                  : 'border-amber-300 text-amber-700'
              }
            >
              {health.botHealthy == null
                ? 'Bot: unknown'
                : health.botHealthy
                  ? 'Bot installed'
                  : 'Bot not installed'}
            </Badge>
            <Badge
              variant="outline"
              className={
                health.permissionsHealthy
                  ? 'border-emerald-300 text-emerald-700'
                  : 'border-amber-300 text-amber-700'
              }
            >
              {health.permissionsHealthy == null
                ? 'Permissions: unknown'
                : health.permissionsHealthy
                  ? 'Permissions OK'
                  : 'Permissions missing/unknown'}
            </Badge>
            {health.lastSuccessAt && (
              <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                <Clock3 className="h-3 w-3 mr-1" /> Last success{' '}
                {new Date(health.lastSuccessAt).toLocaleString()}
              </Badge>
            )}
          </div>
          {health.lastErrorAt && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed">
              <div className="font-semibold">Last failure: {health.lastErrorCode ?? 'UNKNOWN'}</div>
              <div className="text-muted-foreground break-words">
                {health.lastErrorMessage ?? 'No details.'}
              </div>
              <div className="text-muted-foreground mt-1">
                {new Date(health.lastErrorAt).toLocaleString()}
              </div>
            </div>
          )}
          {!health.lastErrorAt && !health.lastSuccessAt && (
            <p className="text-xs text-muted-foreground">
              No delivery history yet — send a test or trigger an incident to exercise the durable
              queue.
            </p>
          )}
        </div>
      )}

      {isConfigured && installationPermissions.length > 0 && (
        <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-3">
          <h3 className="text-sm font-semibold">Installation readiness</h3>
          <p className="text-xs text-muted-foreground">
            Consent and connectivity are resource-scoped. Every installed Team is reported
            independently.
          </p>
          <div className="space-y-2">
            {installationPermissions.map(installation => {
              const healthy = !installation.unknown && installation.missing.length === 0;
              const delivery = health?.installations.find(
                item => item.teamId === installation.teamId
              );
              return (
                <div
                  key={installation.teamId}
                  className="flex items-start justify-between gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {installation.teamName ?? installation.teamId}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {installation.teamId}
                    </div>
                    {!healthy && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {installation.unknown
                          ? (installation.error ?? 'Permission state could not be verified.')
                          : `Missing: ${installation.missing.join(', ')}`}
                      </div>
                    )}
                    {delivery && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {delivery.enabled
                          ? `${delivery.destinationCount} destination(s)`
                          : 'Bot removed'}
                        {delivery.lastDeliveryAt
                          ? ` · Last delivery ${delivery.lastDeliveryStatus?.toLowerCase()} ${new Date(delivery.lastDeliveryAt).toLocaleString()}`
                          : ' · No delivery history'}
                      </div>
                    )}
                    {delivery?.lastErrorMessage && (
                      <div className="mt-1 text-[11px] text-amber-700 break-words">
                        {delivery.lastErrorMessage}
                      </div>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      healthy
                        ? 'border-emerald-300 text-emerald-700'
                        : 'border-amber-300 text-amber-700'
                    }
                  >
                    {healthy ? 'Healthy' : installation.unknown ? 'Unknown' : 'Consent required'}
                  </Badge>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* degraded state hint */}
      {!isConfigured && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">
          Microsoft Teams is in degraded state until Azure credentials are configured above.
          Incident notifications to Teams will be skipped (not retried as failures).
        </div>
      )}
    </div>
  );
}
