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
      findMany: (a: unknown) => Promise<
        Array<{
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
        }>
      >;
    };
    microsoftTeamsInstallation: { count: (a: unknown) => Promise<number> };
  };

  // Run initial configuration and routing queries concurrently
  const [config, destinations, installationCount] = await Promise.all([
    prismaAny.microsoftTeamsConfig.findFirst({ orderBy: { updatedAt: 'desc' } }),
    prismaAny.microsoftTeamsDestination.findMany({
      where: { enabled: true },
      orderBy: { updatedAt: 'desc' },
      include: { service: { select: { name: true } } },
    }),
    prismaAny.microsoftTeamsInstallation.count({
      where: { enabled: true },
    }),
  ]);

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
    extraValidDomains: [
      'opssentinal.com',
      '*.opssentinal.com',
      'opsknight.com',
      '*.opsknight.com',
      ...(process.env.MICROSOFT_TEAMS_VALID_DOMAINS
        ? process.env.MICROSOFT_TEAMS_VALID_DOMAINS.split(',').map(s => s.trim())
        : []),
    ],
  });
  const rscState = isConnected ? await getTeamsGrantedRscPermissions().catch(() => null) : null;
  const rscUnknown = !rscState || rscState.unknown;
  const rscMissingCount = rscState?.missing.length ?? 0;
  const health = isConnected
    ? await getMicrosoftTeamsHealth({ tenantId: config?.tenantId ?? undefined, rscState }).catch(
        () => null
      )
    : null;
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
  let warRoomSnapshots: Awaited<ReturnType<typeof getWarRoomOperationalSnapshots>> | null = null;
  let fleetSummary: import('@/lib/war-room/operations/types').IntegrationHealthSummary[] | null =
    null;
  let warRoomDiagnosticsError: string | null = null;
  let cleanupPendingCounts: Record<string, number> = {};
  try {
    const diagnosticsMod = await import('@/lib/war-room/operations/diagnostics');
    [warRoomSnapshots, fleetSummary, cleanupPendingCounts] = await Promise.all([
      getWarRoomOperationalSnapshots(100, { provider: 'MICROSOFT_TEAMS', rscUnknownByContainerId }),
      diagnosticsMod
        .getWarRoomFleetOperationalSummary({ provider: 'MICROSOFT_TEAMS', rscUnknownByContainerId })
        .catch(
          () => null as import('@/lib/war-room/operations/types').IntegrationHealthSummary[] | null
        ),
      diagnosticsMod.getWarRoomCleanupPendingCounts().catch(() => ({}) as Record<string, number>),
    ]);
  } catch (err) {
    warRoomDiagnosticsError =
      err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
    warRoomSnapshots = null;
  }
  // Fleet summary is authoritative for health; paginated snapshots only drive the table.
  const operationalSummary =
    fleetSummary ?? (warRoomSnapshots ? summarizeOperationalHealth(warRoomSnapshots) : []);
  const teamsSummary = operationalSummary.find(s => s.provider === 'MICROSOFT_TEAMS') ?? null;

  // 1. Integration Readiness: Is Teams configured, credentials valid, bot healthy, and RSC permissions intact?
  const integrationReadiness: import('@/lib/war-room/operations/types').OperationalHealth =
    !isConnected
      ? 'UNAVAILABLE'
      : rscUnknown
        ? 'UNKNOWN'
        : rscMissingCount > 0
          ? 'DEGRADED'
          : health?.botHealthy === false
            ? 'DEGRADED'
            : 'HEALTHY';

  // 2. Operational Fleet Health & Debt: Historical war rooms, degraded channels, cleanup pending
  const operationalFleetHealth: import('@/lib/war-room/operations/types').OperationalHealth =
    warRoomDiagnosticsError ? ('UNKNOWN' as const) : (teamsSummary?.operationalHealth ?? 'HEALTHY');
  // Fleet totals are authoritative; the paginated table is only a view (limit 100).
  const totalWarRooms =
    teamsSummary?.totalRooms ?? (warRoomSnapshots ? warRoomSnapshots.length : 0);
  // Unbounded debt — not limited to the paginated 100 window
  const warRoomCleanupPending =
    cleanupPendingCounts['MICROSOFT_TEAMS'] ??
    teamsSummary?.externalCleanupPending ??
    (warRoomSnapshots ? warRoomSnapshots.filter(s => s.externalCleanupPending).length : 0);

  return (
    <div className="space-y-6">
      <DetailHeroBanner
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
            valueClassName:
              destinations.length > 0
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
                : rscMissingCount === 0
                  ? 'Available'
                  : 'Blocked',
            icon: <RefreshCw className="h-4 w-4" />,
            valueClassName:
              !rscUnknown && rscMissingCount === 0
                ? 'text-emerald-300 font-semibold text-sm sm:text-base'
                : rscUnknown
                  ? 'text-primary-foreground/70 font-semibold text-sm sm:text-base'
                  : 'text-amber-300 font-semibold text-sm sm:text-base',
            subtext:
              rscUnknown && isConnected
                ? `Graph probe: ${rscState?.error ?? 'pending install'}`
                : rscMissingCount === 0
                  ? 'Channel listing verified'
                  : 'Channel listing denied',
          },
        ]}
      />

      <MicrosoftTeamsIntegrationPage
        config={
          config as unknown as {
            id: string;
            clientId: string;
            tenantId?: string | null;
            tenantMode: string;
            enabled: boolean;
            interactiveEnabled: boolean;
            warRoomsEnabled: boolean;
            defaultMeetingOrganizerUpn?: string | null;
          } | null
        }
        destinations={destinations as unknown as MicrosoftTeamsDestinationRow[]}
        appManifestJson={manifestJson}
        isAdmin={permissions.isAdmin}
        health={health}
        installationCount={installationCount}
        installationPermissions={installationPermissions}
        warRoomSnapshots={
          (warRoomSnapshots ??
            []) as unknown as import('@/lib/war-room/operations/types').WarRoomOperationalSnapshot[]
        }
        fleetSummary={teamsSummary}
        integrationReadiness={integrationReadiness}
        operationalFleetHealth={operationalFleetHealth}
        totalWarRooms={totalWarRooms}
        warRoomCleanupPending={warRoomCleanupPending}
        rscState={rscState}
        warRoomDiagnosticsError={warRoomDiagnosticsError}
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
  warRoomEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  service?: { name: string } | null;
};
