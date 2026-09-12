import type { MicrosoftTeamsFailureCode } from './capabilities';

export type MicrosoftTeamsHealth = {
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: MicrosoftTeamsFailureCode | null;
  lastErrorMessage: string | null;
  botHealthy: boolean | null;
  permissionsHealthy: boolean | null;
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
}): Promise<MicrosoftTeamsHealth> {
  let lastSuccessAt: string | null = null;
  let lastErrorAt: string | null = null;
  let lastErrorMessage: string | null = null;
  const lastErrorCode: MicrosoftTeamsFailureCode | null = null;

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
  return {
    lastSuccessAt,
    lastErrorAt,
    lastErrorCode: caps?.failureCode ?? lastErrorCode,
    lastErrorMessage: caps?.failureReason ?? lastErrorMessage,
    botHealthy: caps ? caps.botInstalled : null,
    permissionsHealthy: caps ? caps.canPost : null,
  };
}
