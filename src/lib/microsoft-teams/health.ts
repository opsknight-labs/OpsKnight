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
 * Lightweight health model — persisted via in-memory LRU + audit trail in
 * Notification rows. Real provider health is derived from last delivery attempt
 * (Notification.lastAttemptAt/errorMsg) and RSC probe — not a separate table.
 * This module centralizes the read path so the wizard + status chip share one
 * interpretation of "healthy".
 */
export async function getMicrosoftTeamsHealth(options?: {
  tenantId?: string;
}): Promise<MicrosoftTeamsHealth> {
  const prisma = (await import('@/lib/prisma')).default as unknown as {
    notification: {
      findFirst: (a: unknown) => Promise<{
        createdAt: Date;
        errorMsg: string | null;
        status: string;
      } | null>;
    };
  };
  let lastSuccessAt: string | null = null;
  let lastErrorAt: string | null = null;
  let lastErrorMessage: string | null = null;
  const lastErrorCode: MicrosoftTeamsFailureCode | null = null;
  try {
    const last = await prisma.notification.findFirst({
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
