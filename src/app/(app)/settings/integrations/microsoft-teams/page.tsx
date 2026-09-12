import { getUserPermissions } from '@/lib/rbac';
import { redirect } from 'next/navigation';
import DetailHeroBanner from '@/components/ui/DetailHeroBanner';
import { Badge } from '@/components/ui/shadcn/badge';
import { MicrosoftTeamsLogo } from '@/components/common/BrandLogos';
import { Shield, Globe, KeyRound, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import prisma from '@/lib/prisma';
import MicrosoftTeamsIntegrationPage from '@/components/settings/microsoft-teams/MicrosoftTeamsIntegrationPage';
import { getBaseUrl } from '@/lib/env-validation';
import { buildMicrosoftTeamsAppManifestJson, MICROSOFT_TEAMS_RSC_PERMISSIONS, findMissingRequiredRscPermissions } from '@/lib/microsoft-teams/app-manifest';

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
        createdAt: Date;
        updatedAt: Date;
        service?: { name: string } | null;
      }>>;
    };
  };

  const config = await prismaAny.microsoftTeamsConfig.findFirst({ orderBy: { updatedAt: 'desc' } });
  const destinations = await prismaAny.microsoftTeamsDestination.findMany({
    orderBy: { updatedAt: 'desc' },
    include: { service: { select: { name: true } } },
  });

  const isConnected = Boolean(config?.enabled && config?.clientId);

  const manifestJson = buildMicrosoftTeamsAppManifestJson({ appUrl: getBaseUrl() });
  const missingPermissions = findMissingRequiredRscPermissions(MICROSOFT_TEAMS_RSC_PERMISSIONS);

  return (
    <div className="space-y-6">
      <DetailHeroBanner
        breadcrumb={{ label: 'Settings', href: '/settings', current: 'Microsoft Teams' }}
        tag="COLLABORATION ENGINE"
        title="Microsoft Teams Integration"
        subtitle="Send incident Adaptive Cards to Teams channels for broadcast and lifecycle tracking. Phase 1 delivers one-way notifications."
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
            label: 'Permissions',
            value: isConnected && missingPermissions.length === 0 ? `${MICROSOFT_TEAMS_RSC_PERMISSIONS.length} granted` : isConnected ? `${missingPermissions.length} missing` : 'Not configured',
            icon: <RefreshCw className="h-4 w-4" />,
            valueClassName: missingPermissions.length === 0
              ? 'text-emerald-300 font-semibold text-sm sm:text-base'
              : 'text-amber-300 font-semibold text-sm sm:text-base',
            subtext: 'RSC permissions',
          },
        ]}
      />

      <MicrosoftTeamsIntegrationPage
        config={config as unknown as { id: string; clientId: string; tenantId?: string | null; tenantMode: string; enabled: boolean } | null}
        destinations={destinations as unknown as MicrosoftTeamsDestinationRow[]}
        appManifestJson={manifestJson}
        isAdmin={permissions.isAdmin}
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
  createdAt: Date;
  updatedAt: Date;
  service?: { name: string } | null;
};
