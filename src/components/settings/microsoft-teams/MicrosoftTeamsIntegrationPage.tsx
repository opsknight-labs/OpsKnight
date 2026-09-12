'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/shadcn/button';
import { Input } from '@/components/ui/shadcn/input';
import { Label } from '@/components/ui/shadcn/label';
import { Badge } from '@/components/ui/shadcn/badge';
import { notify as toast } from '@/lib/toast';
import { MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { Copy, Check, AlertTriangle, ShieldCheck, Hash, ExternalLink, Activity, Clock3 } from 'lucide-react';

type DestinationRow = {
  id: string;
  serviceId: string;
  tenantId: string;
  teamId: string;
  channelId: string;
  channelName?: string | null;
  teamName?: string | null;
  enabled: boolean;
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
} | null;

export default function MicrosoftTeamsIntegrationPage({
  config,
  destinations,
  appManifestJson,
  isAdmin,
  health,
}: {
  config: { id: string; clientId: string; tenantId?: string | null; tenantMode: string; enabled: boolean } | null;
  destinations: DestinationRow[];
  appManifestJson: string;
  isAdmin: boolean;
  health?: TeamsHealth;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const isConfigured = Boolean(config?.clientId);
  const isInstalled = destinations.length > 0;

  const onSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!isAdmin) return;
    const form = new FormData(e.currentTarget);
    setSaving(true);
    try {
      const { saveMicrosoftTeamsConfig } = await import('@/app/(app)/settings/integrations/microsoft-teams/actions');
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
        className={`rounded-xl border p-4 text-xs ${!isConfigured ? 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200' : !isInstalled ? 'border-blue-500/30 bg-blue-500/10 text-blue-900 dark:text-blue-200' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200'}`}
      >
        <div className="flex items-center gap-2 font-semibold">
          {!isConfigured ? <AlertTriangle className="h-4 w-4" /> : !isInstalled ? <Hash className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
          <span>
            {!isConfigured ? 'Not configured — enter your Azure AD app credentials below.' : !isInstalled ? 'Credentials configured — install the app to a Team/Channel, then map a Service → Teams destination.' : 'Installed — incident Adaptive Cards will post to your Teams channels on Triggered / Acknowledged / Resolved.'}
          </span>
        </div>
        <p className="mt-1 opacity-80">Phase 1 is one-way broadcast only. Acknowledge / Resolve / Assign from Teams is prepared for Phase 2 and is intentionally not exposed.</p>
      </div>

      {/* Configure card — console UI only, no .env */}
      <form onSubmit={onSave} className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-[#5B5BD6]/10 border border-[#5B5BD6]/20 flex items-center justify-center">
            <MicrosoftTeamsLogo className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Azure AD App Credentials</h3>
            <p className="text-xs text-muted-foreground">Stored encrypted in the database (AES-256-GCM). No secret in .env.</p>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mt-clientId">Application (client) ID</Label>
            <Input id="mt-clientId" name="clientId" placeholder="00000000-0000-0000-0000-000000000000" defaultValue={config?.clientId ?? ''} disabled={!isAdmin} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mt-clientSecret">Client Secret</Label>
            <Input id="mt-clientSecret" name="clientSecret" type="password" placeholder={config ? '•••••••• (leave blank to keep)' : 'Client secret value'} disabled={!isAdmin} />
            <p className="text-[11px] text-muted-foreground">Value is encrypted at rest and never returned.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mt-tenantId">Tenant ID (optional for MULTI)</Label>
            <Input id="mt-tenantId" name="tenantId" placeholder="Entra tenant GUID (SINGLE mode)" defaultValue={config?.tenantId ?? ''} disabled={!isAdmin} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mt-tenantMode">Tenant Mode</Label>
            <select id="mt-tenantMode" name="tenantMode" defaultValue={config?.tenantMode ?? 'SINGLE'} disabled={!isAdmin} className="h-9 w-full rounded-md border bg-background px-3 text-sm">
              <option value="SINGLE">SINGLE</option>
              <option value="MULTI">MULTI</option>
            </select>
          </div>
        </div>
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
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => copy(window.location.origin + '/api/microsoft-teams/messages', 'endpoint')}>
            {copied === 'endpoint' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="ml-1">Bot endpoint</span>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">App manifest is the single source of truth for RSC permissions (`ChannelSettings.Read.Group` + `ChannelMessage.Send.Group` in Phase 1).</p>
        <pre className="max-h-64 overflow-auto rounded-lg border bg-muted/30 p-3 text-[11px] font-mono">{appManifestJson}</pre>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => copy(appManifestJson, 'manifest')}>
            {copied === 'manifest' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            <span className="ml-1">Copy manifest</span>
          </Button>
          <a href="https://dev.teams.microsoft.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            Teams Developer Portal <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Service → Teams destination (Phase 1: one Teams channel per service) */}
      <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Service → Teams destinations</h3>
          <Badge variant="outline" className="text-[10px]">
            {destinations.length} mapped
          </Badge>
        </div>
        {destinations.length === 0 ? (
          <p className="text-xs text-muted-foreground">No service is mapped to a Teams channel yet. After installing the bot to a Team/Channel, map a service to `tenantId / teamId / channelId` from the Service settings or via the API.</p>
        ) : (
          <div className="space-y-2">
            {destinations.map(d => (
              <div key={d.id} className="flex items-center justify-between rounded-lg border p-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{d.service?.name ?? d.serviceId}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {(d.teamName ?? d.teamId) + ' → ' + (d.channelName ?? d.channelId)}
                  </div>
                </div>
                <Button size="sm" variant="outline" className="h-7 text-xs shrink-0 ml-3" onClick={() => onTest(d.id)} disabled={testing === d.id}>
                  {testing === d.id ? 'Sending…' : 'Send Test'}
                </Button>
              </div>
            ))}
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">Send Test posts an Adaptive Card to the mapped channel via Graph and exercises the durable notification control plane, provider admission, and rate limiting.</p>
      </div>

      {/* Health: last delivery + bot/permissions pills (server-provided, not polling) */}
      {isConfigured && health && (
        <div className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold">Delivery health</h3>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className={health.botHealthy ? 'border-emerald-300 text-emerald-700' : 'border-amber-300 text-amber-700'}>
              {health.botHealthy == null ? 'Bot: unknown' : health.botHealthy ? 'Bot installed' : 'Bot not installed'}
            </Badge>
            <Badge variant="outline" className={health.permissionsHealthy ? 'border-emerald-300 text-emerald-700' : 'border-amber-300 text-amber-700'}>
              {health.permissionsHealthy == null ? 'Permissions: unknown' : health.permissionsHealthy ? 'Permissions OK' : 'Permissions missing/unknown'}
            </Badge>
            {health.lastSuccessAt && (
              <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                <Clock3 className="h-3 w-3 mr-1" /> Last success {new Date(health.lastSuccessAt).toLocaleString()}
              </Badge>
            )}
          </div>
          {health.lastErrorAt && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed">
              <div className="font-semibold">Last failure: {health.lastErrorCode ?? 'UNKNOWN'}</div>
              <div className="text-muted-foreground break-words">{health.lastErrorMessage ?? 'No details.'}</div>
              <div className="text-muted-foreground mt-1">{new Date(health.lastErrorAt).toLocaleString()}</div>
            </div>
          )}
          {!health.lastErrorAt && !health.lastSuccessAt && (
            <p className="text-xs text-muted-foreground">No delivery history yet — send a test or trigger an incident to exercise the durable queue.</p>
          )}
          {health.lastErrorCode === 'UNKNOWN' && health.permissionsHealthy === false && (
            <p className="text-xs text-muted-foreground">
              Updates via Graph app-only PATCH are limited to <code className="rounded bg-muted px-1">policyViolation</code> edits — normal channel messages are publish-only until delegated auth ships.
              No duplicate cards will be created when PATCH is unsupported.
            </p>
          )}
        </div>
      )}

      {/* degraded state hint */}
      {!isConfigured && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-xs text-destructive">
          Microsoft Teams is in degraded state until Azure credentials are configured above. Incident notifications to Teams will be skipped (not retried as failures).
        </div>
      )}
    </div>
  );
}
