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

// ---------------------------------------------------------------------------
// Bot Framework inbound activity authentication
// ---------------------------------------------------------------------------

export type VerifiedTeamsIdentity = {
  tenantId: string;
  serviceUrl: string | null;
  appId: string;
};

let botJwksCache: { jwks: Record<string, unknown>; fetchedAt: number } | null = null;
const BOT_OPENID_URL = 'https://login.botframework.com/v1/.well-known/openidconfiguration';
const BOT_JWKS_TTL_MS = 60 * 60 * 1000;

async function fetchBotJwks(forceRefresh = false): Promise<Record<string, unknown>> {
  const now = Date.now();
  if (!forceRefresh && botJwksCache && now - botJwksCache.fetchedAt < BOT_JWKS_TTL_MS) {
    return botJwksCache.jwks;
  }
  const oidRes = await fetch(BOT_OPENID_URL, { cache: 'no-store' as RequestCache });
  if (!oidRes.ok) throw new Error(`Bot Framework OpenID discovery failed: ${oidRes.status}`);
  const oid = (await oidRes.json()) as { jwks_uri?: string };
  const jwksUri = oid.jwks_uri || 'https://login.botframework.com/v1/.well-known/keys';
  const jwksRes = await fetch(jwksUri, { cache: 'no-store' as RequestCache });
  if (!jwksRes.ok) throw new Error(`Bot Framework JWKS fetch failed: ${jwksRes.status}`);
  const jwks = (await jwksRes.json()) as Record<string, unknown>;
  botJwksCache = { jwks, fetchedAt: now };
  return jwks;
}

async function verifyBotFrameworkToken(token: string, expectedAppId: string): Promise<VerifiedTeamsIdentity | null> {
  let jwks = await fetchBotJwks();
  const jose = await import('jose');

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const localSet = jose.createLocalJWKSet(jwks as never);
      const result = await jose.jwtVerify(token, localSet as never, {
        // Bot Framework uses multiple issuers — validate manually below
        issuer: undefined,
        audience: undefined,
      });
      const claims = result.payload as Record<string, unknown>;
      const rawAud = claims.aud;
      const aud = typeof rawAud === 'string' ? rawAud : Array.isArray(rawAud) ? String(rawAud[0] ?? '') : '';
      const iss = typeof claims.iss === 'string' ? claims.iss : '';
      const tid =
        typeof claims.tid === 'string'
          ? (claims.tid as string)
          : typeof (claims as Record<string, unknown>).tenantId === 'string'
            ? String((claims as Record<string, unknown>).tenantId)
            : '';
      const serviceUrl = typeof claims.serviceurl === 'string' ? (claims.serviceurl as string) : null;

      if (aud !== expectedAppId) {
        logger.warn('[MicrosoftTeams] Bot JWT aud mismatch', {
          aud: aud.slice(0, 8) + '...',
          expected: expectedAppId.slice(0, 8) + '...',
        });
        return null;
      }

      const issOk =
        iss.startsWith('https://api.botframework.com') ||
        iss.startsWith('https://login.botframework.com') ||
        iss.startsWith('https://sts.windows.net/') ||
        iss.startsWith('https://login.microsoftonline.com/');
      if (!issOk) {
        logger.warn('[MicrosoftTeams] Bot JWT unexpected issuer', { iss });
        return null;
      }

      return { tenantId: tid || '', serviceUrl, appId: aud };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isUnknownKid = /kid|JWK|signature|no applicable/i.test(msg);
      if (isUnknownKid && attempt === 0) {
        jwks = await fetchBotJwks(true);
        continue;
      }
      logger.warn('[MicrosoftTeams] Bot JWT verification failed', { error: msg.slice(0, 300) });
      return null;
    }
  }
  return null;
}

export async function assertMicrosoftTeamsActivityAuth(request: Request): Promise<VerifiedTeamsIdentity | null> {
  // Test harness bypass — only in non-production
  if (process.env.NODE_ENV !== 'production' && request.headers.get('x-opsknight-teams-test') === '1') {
    return { tenantId: '__test__', serviceUrl: null, appId: '__test__' };
  }

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return null;

  const resolved = await getMicrosoftTeamsConfig();
  if (!resolved) return null;

  return verifyBotFrameworkToken(token, resolved.config.clientId);
}

// Test-only helpers
export function __clearBotJwksCacheForTests(): void {
  botJwksCache = null;
}

export async function decryptMicrosoftTeamsSecret(value: string): Promise<string> {
  return decryptStoredSecret(value);
}
