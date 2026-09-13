import type { MicrosoftTeamsFailureCode } from './capabilities';
import type { TeamsRscGrantState } from './client';

export type MicrosoftTeamsHealth = {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: MicrosoftTeamsFailureCode | null;
  lastErrorMessage: string | null;
  botHealthy: boolean | null;
  permissionsHealthy: boolean | null;
  installations: MicrosoftTeamsInstallationHealth[];
};

export type MicrosoftTeamsInstallationHealth = {
  teamId: string;
  teamName: string | null;
  enabled: boolean;
  destinationCount: number;
  lastDeliveryAt: string | null;
  lastDeliveryStatus: string | null;
  lastErrorMessage: string | null;
};

/**
 * Health derivation for the Teams wizard + status chip.
 *
 * Authoritative source is `ExternalOperation` (claim-first durable fence that
 * the real incident path writes via `enqueueMicrosoftTeamsDelivery`). We fall
 * back to `Notification` for lean control-plane lookups (test route) and for
 * backwards compat with any pre-fence rows.
 */
export async function getMicrosoftTeamsHealth(options?: {
  tenantId?: string;
  rscState?: TeamsRscGrantState | null;
}): Promise<MicrosoftTeamsHealth> {
  let lastSuccessAt: string | null = null;
  let lastErrorAt: string | null = null;
  let lastErrorMessage: string | null = null;
  const lastErrorCode: MicrosoftTeamsFailureCode | null = null;
  const installationHealth: MicrosoftTeamsInstallationHealth[] = [];

  // 1) Preferred: ExternalOperation (durable fence used by real incident delivery).
  //    Status: COMPLETED = success, FAILED/AMBIGUOUS = error.
  try {
    const prismaOp = (await import('@/lib/prisma')).default as unknown as {
      externalOperation: {
        findFirst: (a: unknown) => Promise<{ updatedAt: Date; status: string; lastError: string | null } | null>;
      };
    };
    const lastOp = await prismaOp.externalOperation.findFirst({
      where: { provider: 'MICROSOFT_TEAMS' as never },
      orderBy: { updatedAt: 'desc' },
      select: { updatedAt: true, status: true, lastError: true },
    } as never);
    if (lastOp) {
      if (lastOp.status === 'COMPLETED') lastSuccessAt = lastOp.updatedAt.toISOString();
      else if (lastOp.status === 'FAILED' || lastOp.status === 'AMBIGUOUS') {
        lastErrorAt = lastOp.updatedAt.toISOString();
        lastErrorMessage = lastOp.lastError?.slice(0, 400) ?? null;
      }
    }
  } catch {
    // best-effort
  }

  // 2) Fallback: Notification (test route + slack-compat path) when ExternalOperation has no rows.
  if (!lastSuccessAt && !lastErrorAt) {
    try {
      const prismaNotif = (await import('@/lib/prisma')).default as unknown as {
        notification: {
          findFirst: (a: unknown) => Promise<{ createdAt: Date; errorMsg: string | null; status: string } | null>;
        };
      };
      const last = await prismaNotif.notification.findFirst({
        where: { channel: 'MICROSOFT_TEAMS' as never },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true, errorMsg: true, status: true },
      } as never);
      if (last) {
        if (last.status === 'SENT') lastSuccessAt = last.createdAt.toISOString();
        else if (last.status === 'FAILED') {
          lastErrorAt = last.createdAt.toISOString();
          lastErrorMessage = last.errorMsg?.slice(0, 400) ?? null;
        }
      }
    } catch {
      // best-effort
    }
  }

  const { getMicrosoftTeamsCapabilities } = await import('./capabilities');
  const caps = await getMicrosoftTeamsCapabilities(options).catch(() => null);

  // Resource truth: correlate each verified installation with its destinations
  // and most recent durable operation. Overall health must never conceal a
  // broken Team behind a successful operation for a different Team.
  try {
    const prismaHealth = (await import('@/lib/prisma')).default as unknown as {
      microsoftTeamsInstallation: {
        findMany: (a: unknown) => Promise<Array<{
          teamId: string;
          teamName: string | null;
          enabled: boolean;
          destinations: Array<{ id: string }>;
        }>>;
      };
      externalOperation: {
        findMany: (a: unknown) => Promise<Array<{
          status: string;
          updatedAt: Date;
          lastError: string | null;
          requestPayload: unknown;
        }>>;
      };
    };
    const tenantId = options?.tenantId?.trim();
    const installations = await prismaHealth.microsoftTeamsInstallation.findMany({
      where: { ...(tenantId ? { tenantId } : {}) },
      select: {
        teamId: true,
        teamName: true,
        enabled: true,
        // Only routable (enabled) destinations — tombstoned rows are ledger history for AMBIGUOUS reconciliation, not active routing
        destinations: { where: { enabled: true }, select: { id: true } },
      },
      orderBy: { teamName: 'asc' },
      take: 100,
    });
    const destinationIds = installations.flatMap(installation => installation.destinations.map(destination => destination.id));
    const latestByDestination = new Map<string, { status: string; updatedAt: Date; lastError: string | null }>();
    if (destinationIds.length > 0) {
      const operations = await prismaHealth.externalOperation.findMany({
        where: { provider: 'MICROSOFT_TEAMS' as never },
        orderBy: { updatedAt: 'desc' },
        take: 500,
        select: { status: true, updatedAt: true, lastError: true, requestPayload: true },
      });
      const allowedDestinationIds = new Set(destinationIds);
      for (const operation of operations) {
        const destinationId = (operation.requestPayload as Record<string, unknown> | null)?.destinationId;
        if (typeof destinationId !== 'string' || !allowedDestinationIds.has(destinationId) || latestByDestination.has(destinationId)) continue;
        latestByDestination.set(destinationId, operation);
      }
    }
    for (const installation of installations) {
      const latest = installation.destinations
        .map(destination => latestByDestination.get(destination.id))
        .filter((operation): operation is NonNullable<typeof operation> => Boolean(operation))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
      installationHealth.push({
        teamId: installation.teamId,
        teamName: installation.teamName,
        enabled: installation.enabled,
        destinationCount: installation.destinations.length,
        lastDeliveryAt: latest?.updatedAt.toISOString() ?? null,
        lastDeliveryStatus: latest?.status ?? null,
        lastErrorMessage: latest?.lastError?.slice(0, 400) ?? null,
      });
    }
  } catch {
    // best-effort health enrichment
  }
  return {
    lastSuccessAt,
    lastErrorAt,
    lastErrorCode: caps?.failureCode ?? lastErrorCode,
    lastErrorMessage: caps?.failureReason ?? lastErrorMessage,
    botHealthy: caps ? caps.botInstalled : null,
    permissionsHealthy: caps ? caps.canPost : null,
    installations: installationHealth,
  };
}
