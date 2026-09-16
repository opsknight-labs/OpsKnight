import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import { MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { Shield, Globe, KeyRound, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import prisma from '@/lib/prisma';
import MicrosoftTeamsIntegrationPage from '@/components/settings/microsoft-teams/MicrosoftTeamsIntegrationPage';
import { getBaseUrl } from '@/lib/env-validation';
import { buildMicrosoftTeamsAppManifestJson } from '@/lib/microsoft-teams/app-manifest';
import { getTeamsGrantedRscPermissions } from '@/lib/microsoft-teams/client';
import { getMicrosoftTeamsHealth } from '@/lib/microsoft-teams/health';
import WarRoomOperationsSection from '@/components/settings/microsoft-teams/WarRoomOperationsSection';
import { getWarRoomOperationalSnapshots } from '@/lib/war-room/operations/diagnostics';
import { summarizeOperationalHealth } from '@/lib/war-room/operations/summary';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function MicrosoftTeamsIntegrationRoute() {
  const permissions = await getUserPermissions();
  if (!permissions) redirect('/login');
  if (!permissions.isAdmin) redirect('/settings');

  const prismaAny = prisma as unknown as {
    microsoftTeamsConfig: {
      findFirst: (a: unknown) => Promise<{
        id: string;
        clientId: string;
        tenantId: string | null;
        tenantMode: 'SINGLE' | 'MULTI';
        enabled: boolean;
        interactiveEnabled: boolean;
        warRoomsEnabled: boolean;
        createdAt: Date;
        updatedAt: Date;
        updatedBy?: string | null;
      } | null>;
    };
    microsoftTeamsDestination: {
      findMany: (a: unknown) => Promise<Array<{
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
      }>>;
    };
    microsoftTeamsInstallation: { count: (a: unknown) => Promise<number> };
  };

  const config = await prismaAny.microsoftTeamsConfig.findFirst({ orderBy: { updatedAt: 'desc' } });
  // Only routable destinations — tombstoned rows (enabled=false) are preserved for ledger/AMBIGUOUS reconciliation but not shown as active routing
  const destinations = await prismaAny.microsoftTeamsDestination.findMany({
    where: { enabled: true },
    orderBy: { updatedAt: 'desc' },
    include: { service: { select: { name: true } } },
  });
  const installationCount = await prismaAny.microsoftTeamsInstallation.count({ where: { enabled: true } });

  const isConnected = Boolean(config?.enabled && config?.clientId);

  const manifestJson = buildMicrosoftTeamsAppManifestJson({
    appUrl: getBaseUrl(),
    botId: config?.clientId ?? '11111111-1111-1111-1111-111111111111',
    // Override the stable host-derived default when Entra uses a custom Application ID URI.
    applicationIdUri: process.env.MICROSOFT_TEAMS_APPLICATION_ID_URI?.trim() || undefined,
    // Team discovery and war-room administration are separate opt-in consent
    // surfaces. Enabling war rooms requests the operational RSC set needed for
    // lifecycle updates and identity-safe participant synchronization.
    includeTeamSettingsPermissions: process.env.MICROSOFT_TEAMS_INCLUDE_OPTIONAL_RSC === '1',
    includeWarRoomPermissions: config?.warRoomsEnabled ?? false,
    includeWarRoomCollaborationPermissions: config?.warRoomsEnabled ?? false,
  });
  const rscState = isConnected ? await getTeamsGrantedRscPermissions().catch(() => null) : null;
  const rscUnknown = !rscState || rscState.unknown;
  const rscMissingCount = rscState?.missing.length ?? 0;
  const health = isConnected ? await getMicrosoftTeamsHealth({ tenantId: config?.tenantId ?? undefined, rscState }).catch(() => null) : null;
  const installationPermissions = [...(rscState?.installations ?? [])];
  for (const installation of health?.installations ?? []) {
    if (installationPermissions.some(state => state.teamId === installation.teamId)) continue;
    installationPermissions.push({
      teamId: installation.teamId,
      teamName: installation.teamName,
      granted: null,
      missing: [],
      unknown: true,
      error: installation.enabled ? 'PERMISSION_STATE_UNAVAILABLE' : 'BOT_REMOVED',
    });
  }

  // War-room Operations — provider-neutral operational snapshot (preserve per-installation correlation from getMicrosoftTeamsHealth)
  // Build per-Team rscUnknown map: providerContainerId (teamId) -> unknown flag, so health can surface UNKNOWN when RSC is unverified.
  const rscUnknownByContainerId = new Map<string, boolean>();
  for (const row of installationPermissions) {
    rscUnknownByContainerId.set(String(row.teamId), Boolean(row.unknown));
  }
  const [warRoomSnapshots, cleanupPendingCounts] = await Promise.all([
    getWarRoomOperationalSnapshots(100, { provider: 'MICROSOFT_TEAMS', rscUnknownByContainerId }).catch(() => [] as Awaited<ReturnType<typeof getWarRoomOperationalSnapshots>>),
    (await import('@/lib/war-room/operations/diagnostics')).getWarRoomCleanupPendingCounts().catch(() => ({} as Record<string, number>)),
  ]);
  const operationalSummary = summarizeOperationalHealth(warRoomSnapshots);
  const teamsSummary = operationalSummary.find(s => s.provider === 'MICROSOFT_TEAMS') ?? null;
  // Health is derived from configuration+authentication+installation+permissions+room health — no `0 rooms => HEALTHY` fallthrough.
  // When there are no Teams war rooms yet, the label reflects integration posture (UNKNOWN/UNAVAILABLE/DEGRADED) rather than a synthetic HEALTHY.
  const integrationHealthForEmpty: import('@/lib/war-room/operations/types').OperationalHealth = !isConnected
    ? 'UNAVAILABLE'
    : rscUnknown
      ? 'UNKNOWN'
      : rscMissingCount > 0
        ? 'DEGRADED'
        : health?.botHealthy === false
          ? 'DEGRADED'
          : 'HEALTHY';
  const operationalHealthLabel = teamsSummary?.operationalHealth ?? integrationHealthForEmpty;
  const totalWarRooms = warRoomSnapshots.length;
  // Unbounded debt — not limited to the paginated 100 window
  const warRoomCleanupPending = cleanupPendingCounts['MICROSOFT_TEAMS'] ?? warRoomSnapshots.filter(s => s.externalCleanupPending).length;

  return (
    <div className="space-y-6">
      <DetailHeroBanner
        breadcrumb={{ label: 'Settings', href: '/settings', current: 'Microsoft Teams' }}
        tag="COLLABORATION ENGINE"
        title="Microsoft Teams Integration"
        subtitle="Deliver incident cards, lifecycle updates, and controlled collaboration workflows to Microsoft Teams."
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
                isConnected
                  ? 'border-emerald-400/60 bg-emerald-400/15 text-emerald-100'
                  : 'border-amber-400/60 bg-amber-400/15 text-amber-100'
              }`}
            >
              {isConnected ? (
                <>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  App Configured
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Setup Required
                </>
              )}
            </Badge>
          </div>
        }
        statsPlacement="bottom"
        stats={[
          {
            label: 'Azure App',
            value: config?.clientId ? config.clientId.slice(0, 12) + '…' : 'Not configured',
            icon: <MicrosoftTeamsLogo className="h-4 w-4" />,
            tooltip: config?.clientId ?? undefined,
            valueClassName: config?.clientId
              ? 'text-primary-foreground font-semibold text-sm sm:text-base truncate'
              : 'text-primary-foreground/70',
            subtext: 'Console-managed credentials',
          },
          {
            label: 'Client Secret',
            value: 'Encrypted at rest',
            icon: <KeyRound className="h-4 w-4" />,
            valueClassName: 'text-emerald-300 font-semibold text-sm sm:text-base',
            subtext: 'Stored in database, never in .env',
          },
          {
            label: 'Destinations',
            value: destinations.length === 0 ? 'None' : `${destinations.length} service(s)`,
            icon: <Globe className="h-4 w-4" />,
            valueClassName: destinations.length > 0
              ? 'text-emerald-300 font-semibold text-sm sm:text-base'
              : 'text-primary-foreground/70',
            subtext: 'Teams channel routing',
          },
          {
            label: 'Discovery',
            value: !isConnected
              ? 'Not configured'
              : rscUnknown
                ? 'Not verified'
                : rscMissingCount === 0 ? 'Available' : 'Blocked',
            icon: <RefreshCw className="h-4 w-4" />,
            valueClassName: !rscUnknown && rscMissingCount === 0
              ? 'text-emerald-300 font-semibold text-sm sm:text-base'
              : rscUnknown ? 'text-primary-foreground/70 font-semibold text-sm sm:text-base'
              : 'text-amber-300 font-semibold text-sm sm:text-base',
            subtext: rscUnknown && isConnected
              ? `Graph probe: ${rscState?.error ?? 'pending install'}`
              : rscMissingCount === 0 ? 'Channel listing verified' : 'Channel listing denied',
          },
        ]}
      />

      {/* ── Phase 5: 4-area Admin Control Plane (summary → drill-down, no secrets) ── */}
      {/* Area 1 — Integration Health */}
      <section id="integration-health" className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-muted-foreground" /> Integration Health
          </h2>
          <Badge variant="outline" className={`text-[10px] font-semibold ${operationalHealthLabel === 'HEALTHY' ? 'border-emerald-300 text-emerald-700' : operationalHealthLabel === 'UNKNOWN' ? 'border-blue-300 text-blue-700' : operationalHealthLabel === 'UNAVAILABLE' ? 'border-slate-300 text-slate-600' : operationalHealthLabel === 'DRIFTED' ? 'border-violet-300 text-violet-700' : 'border-amber-300 text-amber-700'}`}>
            {operationalHealthLabel}
          </Badge>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <Badge variant="outline" className="text-[10px]">Config {isConnected ? 'connected' : 'not configured'} · war-rooms {config?.warRoomsEnabled ? 'enabled' : 'disabled'}</Badge>
          <Badge variant="outline" className="text-[10px]">{installationCount} installation(s)</Badge>
          <Badge variant="outline" className="text-[10px]">{totalWarRooms} war room(s){warRoomCleanupPending > 0 ? ` · ${warRoomCleanupPending} cleanup pending` : ''}</Badge>
          {health?.botHealthy != null && <Badge variant="outline" className={health.botHealthy ? 'border-emerald-300 text-emerald-700 text-[10px]' : 'border-amber-300 text-amber-700 text-[10px]'}>{health.botHealthy ? 'Bot healthy' : 'Bot degraded'}</Badge>}
          <Badge variant="outline" className="text-[10px]">RSC {rscUnknown ? 'unknown' : rscMissingCount === 0 ? 'ok' : `${rscMissingCount} missing`}</Badge>
        </div>
        {teamsSummary && (
          <div className="text-[11px] text-muted-foreground">
            Teams operational: {teamsSummary.healthyRooms} healthy · {teamsSummary.degradedRooms} degraded · {teamsSummary.driftedRooms} drifted · {teamsSummary.unavailableRooms} unavailable · {teamsSummary.unknownRooms} unknown · cleanup pending {teamsSummary.externalCleanupPending}
          </div>
        )}
        <details className="rounded-lg border bg-muted/20 p-3">
          <summary className="cursor-pointer text-xs font-medium">Drill down — raw integration state (no secrets)</summary>
          <div className="mt-3 space-y-1 text-[11px] font-mono break-all">
            <div>clientId: {config?.clientId ? `${config.clientId.slice(0, 12)}…` : '—'} · tenantId: {config?.tenantId ?? '—'} · enabled: {String(config?.enabled ?? false)} · warRoomsEnabled: {String(config?.warRoomsEnabled ?? false)}</div>
            <div>rscState: {rscUnknown ? `unknown (${rscState?.error ?? 'pending install'})` : `missing=[${rscState?.missing.join(', ') ?? ''}]`}</div>
            <div>health: botHealthy={String(health?.botHealthy ?? 'unknown')} permissionsHealthy={String(health?.permissionsHealthy ?? 'unknown')} lastSuccess={health?.lastSuccessAt ?? '—'} lastError={health?.lastErrorCode ?? '—'}</div>
          </div>
        </details>
      </section>

      {/* Area 2 — Installations & Permissions */}
      <section id="installations-permissions" className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Installations & Permissions</h2>
          <Badge variant="outline" className="text-[10px]">{installationPermissions.length} team(s) · {installationCount} active install(s)</Badge>
        </div>
        <p className="text-xs text-muted-foreground">Per-installation correlation is preserved from <span className="font-mono">getMicrosoftTeamsHealth()</span> — no aggregation hides a broken Team behind a healthy one. Each row shows destination count and last delivery status from the durable queue.</p>
        {installationPermissions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No installations yet — install the Teams app to a Team/Channel and consent to the RSC set.</p>
        ) : (
          <div className="space-y-2">
            {installationPermissions.map(row => {
              const delivery = health?.installations.find(i => i.teamId === row.teamId);
              const healthy = !row.unknown && row.missing.length === 0;
              return (
                <div key={row.teamId} className="flex items-start justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{row.teamName ?? row.teamId}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{row.teamId}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{row.unknown ? row.error ?? 'Permission state unavailable' : row.missing.length === 0 ? 'All RSC granted' : `Missing: ${row.missing.join(', ')}`}</div>
                    {delivery && <div className="mt-1 text-[11px] text-muted-foreground">{delivery.enabled ? `${delivery.destinationCount} destination(s)` : 'Bot removed'} {delivery.lastDeliveryAt ? `· last ${delivery.lastDeliveryStatus} ${new Date(delivery.lastDeliveryAt).toLocaleString()}` : '· no delivery history'}</div>}
                  </div>
                  <Badge variant="outline" className={healthy ? 'border-emerald-300 text-emerald-700 text-[10px]' : 'border-amber-300 text-amber-700 text-[10px]'}>{healthy ? 'Healthy' : row.unknown ? 'Unknown' : 'Consent required'}</Badge>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Area 3 — Destinations */}
      <section id="destinations" className="rounded-xl border bg-card p-5 sm:p-6 shadow-sm space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Destinations</h2>
          <Badge variant="outline" className="text-[10px]">{destinations.length} mapped</Badge>
        </div>
        <p className="text-xs text-muted-foreground">Service → Teams channel routing. Tombstoned rows (enabled=false) are preserved for ledger/AMBIGUOUS reconciliation but only routable destinations are listed here.</p>
        {destinations.length === 0 ? (
          <p className="text-xs text-muted-foreground">No service is mapped to a Teams channel yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-xs">
              <thead><tr className="text-[11px] text-muted-foreground border-b"><th className="text-left font-semibold py-2 px-2">Service</th><th className="text-left font-semibold py-2 px-2">Team / Channel</th><th className="text-left font-semibold py-2 px-2">Interactive</th></tr></thead>
              <tbody>
                {destinations.map(d => (
                  <tr key={d.id} className="border-b last:border-0"><td className="py-2 px-2 font-medium">{d.service?.name ?? d.serviceId}</td><td className="py-2 px-2 truncate max-w-[260px]">{d.teamName ?? d.teamId} → {d.channelName ?? d.channelId}</td><td className="py-2 px-2">{d.interactiveEnabled ? 'ON' : 'OFF'}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Area 4 — War-room Operations (summary → drill-down diagnostics via Admin API, no secrets/tokens) */}
      <section id="war-room-operations">
        <WarRoomOperationsSection snapshots={warRoomSnapshots as unknown as import('@/lib/war-room/operations/types').WarRoomOperationalSnapshot[]} />
      </section>

      {/* Full interactive console (config form, manifest, per-destination actions) — kept for console-managed credential flow; no .env */}
      <MicrosoftTeamsIntegrationPage
        config={config as unknown as { id: string; clientId: string; tenantId?: string | null; tenantMode: string; enabled: boolean; interactiveEnabled: boolean; warRoomsEnabled: boolean } | null}
        destinations={destinations as unknown as MicrosoftTeamsDestinationRow[]}
        appManifestJson={manifestJson}
        isAdmin={permissions.isAdmin}
        health={health}
        installationCount={installationCount}
        installationPermissions={installationPermissions}
      />
    </div>
  );
}

type MicrosoftTeamsDestinationRow = {
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
