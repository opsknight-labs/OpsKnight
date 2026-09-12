import { decrypt, decryptStoredSecret } from '@/lib/encryption';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';

export type MicrosoftTeamsAuthContext = {
  configId: string;
  tenantId?: string | null;
  tenantMode: 'SINGLE' | 'MULTI';
  clientId: string;
  clientSecret: string;
};

/**
 * Resolve the active MicrosoftTeamsConfig for server-side Graph calls.
 * `clientSecret` is decrypted here — never log it.
 */
export async function getMicrosoftTeamsConfig(): Promise<{
  config: NonNullable<Awaited<ReturnType<typeof prisma.microsoftTeamsConfig.findFirst>>>;
  clientSecret: string;
} | null> {
  const config = await prisma.microsoftTeamsConfig.findFirst({
    where: { enabled: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (!config) return null;
  try {
    const clientSecret = await decrypt(config.clientSecret);
    return { config, clientSecret };
  } catch (error) {
    logger.error('[MicrosoftTeams] Failed to decrypt clientSecret', { error: (error as Error).message });
    return null;
  }
}

export async function isMicrosoftTeamsConfigured(): Promise<boolean> {
  const row = await prisma.microsoftTeamsConfig.findFirst({
    where: { enabled: true },
    select: { id: true },
  });
  return Boolean(row);
}

/**
 * Bot Framework / Teams activity auth.
 *
 * Phase 1 stub: the production implementation must validate the incoming
 * activity via the Bot Framework token / Teams SDK `BotFrameworkAdapter`
 * or `CloudAdapter` and must not trust `tenantId`/`teamId`/`userId` from
 * unverified JSON. This helper centralizes that future hook so the route
 * never accidentally reads identities from the body before verification.
 *
 * Today it delegates to the SDK when available; callers should treat a
 * `null` return as "unauthenticated".
 */
export function assertMicrosoftTeamsActivityAuth(_request: Request): Promise<MicrosoftTeamsAuthContext | null> {
  // Phase-1 deliverable exposes the endpoint shape (`conversationUpdate`/`invoke`/`message`)
  // behind a verified-auth seam. Wiring the real CloudAdapter is tracked for the
  // next slice — the route already returns 401 until this returns a context.
  return Promise.resolve(null);
}

export async function decryptMicrosoftTeamsSecret(value: string): Promise<string> {
  return decryptStoredSecret(value);
}
