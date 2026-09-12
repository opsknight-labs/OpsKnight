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

/**
 * Protocol-correct Bot Framework JWT issuers per
 * https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication
 * Issuer is compared by exact host/path — not `startsWith` — to avoid the
 * CodeQL "arbitrary hostname can follow" finding. Tenant-suffixed issuers are
 * accepted only when the scheme+host+prefix exactly match the allowed pattern.
 */
const PROD_BOT_ISSUER = 'https://api.botframework.com';

function isAllowedBotIssuer(iss: string): boolean {
  if (!iss) return false;
  // Production Connector -> Bot: only api.botframework.com per
  // https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication
  // Emulator / dev path (sts.windows.net, login.microsoftonline.com) is allowed only in non-production.
  if (iss === PROD_BOT_ISSUER) return true;
  if (process.env.NODE_ENV === 'production') return false;
  const guid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
  if (new RegExp(`^https:\\/\\/sts\\.windows\\.net\\/${guid}\\/?$`).test(iss)) return true;
  if (new RegExp(`^https:\\/\\/login\\.microsoftonline\\.com\\/${guid}\\/v2\\.0\\/?$`).test(iss)) return true;
  return false;
}

export function __isAllowedBotIssuerForTests(iss: string): boolean {
  // Tests exercise issuer allowlist without NODE_ENV gate — replicate non-prod behavior.
  if (!iss) return false;
  if (iss === PROD_BOT_ISSUER) return true;
  const guid = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
  if (new RegExp(`^https:\\/\\/sts\\.windows\\.net\\/${guid}\\/?$`).test(iss)) return true;
  if (new RegExp(`^https:\\/\\/login\\.microsoftonline\\.com\\/${guid}\\/v2\\.0\\/?$`).test(iss)) return true;
  return false;
}

async function verifyBotFrameworkToken(
  token: string,
  expectedAppId: string,
  options?: { expectedServiceUrl?: string | null }
): Promise<VerifiedTeamsIdentity | null> {
  let jwks = await fetchBotJwks();
  const jose = await import('jose');

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const localSet = jose.createLocalJWKSet(jwks as never);
      const result = await jose.jwtVerify(token, localSet as never, {
        issuer: undefined,
        audience: undefined,
        algorithms: ['RS256', 'RS384', 'RS512'],
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

      if (!isAllowedBotIssuer(iss)) {
        logger.warn('[MicrosoftTeams] Bot JWT unexpected issuer', { iss: iss.slice(0, 120) });
        return null;
      }

      // Bot Connector spec: JWT must carry serviceUrl and it must match
      // Activity.serviceUrl. In production missing claim/body is a reject;
      // in non-prod test traffic may lack the claim — validated only when present.
      const expectedServiceUrl = options?.expectedServiceUrl?.trim() || null;
      const normalize = (value: string): string | null => {
        try {
          const u = new URL(value.trim());
          const withoutHash = u.origin.toLowerCase() + u.pathname.replace(/\/+$/, '') + (u.search || '');
          return withoutHash.replace(/\/$/, '') || u.origin.toLowerCase();
        } catch {
          return null;
        }
      };
      if (process.env.NODE_ENV === 'production') {
        if (!serviceUrl || !expectedServiceUrl) {
          logger.warn('[MicrosoftTeams] Bot JWT missing serviceUrl — rejecting in production');
          return null;
        }
        const claimNorm = normalize(serviceUrl);
        const activityNorm = normalize(expectedServiceUrl);
        if (!claimNorm || !activityNorm) {
          logger.warn('[MicrosoftTeams] Bot JWT serviceUrl unparseable — rejecting', {
            claim: serviceUrl.slice(0, 80),
            activity: expectedServiceUrl.slice(0, 80),
          });
          return null;
        }
        if (claimNorm !== activityNorm) {
          logger.warn('[MicrosoftTeams] Bot JWT serviceUrl mismatch', {
            claimNorm: claimNorm.slice(0, 80),
            activityNorm: activityNorm.slice(0, 80),
          });
          return null;
        }
      } else if (serviceUrl && expectedServiceUrl) {
        const claimNorm = normalize(serviceUrl);
        const activityNorm = normalize(expectedServiceUrl);
        if (!claimNorm || !activityNorm) {
          logger.warn('[MicrosoftTeams] Bot JWT serviceUrl unparseable — rejecting', {
            claim: serviceUrl.slice(0, 80),
            activity: expectedServiceUrl.slice(0, 80),
          });
          return null;
        }
        if (claimNorm !== activityNorm) {
          logger.warn('[MicrosoftTeams] Bot JWT serviceUrl mismatch', {
            claimNorm: claimNorm.slice(0, 80),
            activityNorm: activityNorm.slice(0, 80),
          });
          return null;
        }
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

export async function assertMicrosoftTeamsActivityAuth(
  request: Request,
  options?: { expectedServiceUrl?: string | null }
): Promise<VerifiedTeamsIdentity | null> {
  // Test harness bypass — only in non-production
  if (process.env.NODE_ENV !== 'production' && request.headers.get('x-opsknight-teams-test') === '1') {
    return { tenantId: '__test__', serviceUrl: null, appId: '__test__' };
  }

  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return null;

  const resolved = await getMicrosoftTeamsConfig();
  if (!resolved) return null;

  return verifyBotFrameworkToken(token, resolved.config.clientId, options);
}

/**
 * Tenant allowlist enforcement — fail-closed.
 * SINGLE: verified tid must equal config.tenantId
 * MULTI: verified tid must have an enabled installation
 * __test__ bypass is never allowlisted as a real tenant.
 */
export async function enforceMicrosoftTeamsTenantAllowlist(
  verifiedTenantId: string,
  config: { tenantId: string | null; tenantMode: string },
): Promise<{ allowed: true } | { allowed: false; reason: string; code: string }> {
  if (!verifiedTenantId || verifiedTenantId === '__test__') {
    return { allowed: false, reason: 'Tenant is not verified', code: 'TENANT_REQUIRED' };
  }
  if (config.tenantMode === 'SINGLE') {
    const cfgTid = config.tenantId?.trim();
    if (!cfgTid) return { allowed: false, reason: 'SINGLE tenant not configured', code: 'TENANT_REQUIRED' };
    if (verifiedTenantId !== cfgTid) {
      return { allowed: false, reason: 'Tenant not allowed for SINGLE-mode config', code: 'TENANT_NOT_ALLOWED' };
    }
    return { allowed: true };
  }
  // MULTI — must have at least one enabled installation for this tenant
  const prismaAny = prisma as unknown as {
    microsoftTeamsInstallation: { count: (a: unknown) => Promise<number> };
  };
  const count = await prismaAny.microsoftTeamsInstallation.count({
    where: { tenantId: verifiedTenantId, enabled: true },
  } as never);
  if (count === 0) {
    return { allowed: false, reason: 'Teams app not installed for tenant', code: 'APP_NOT_INSTALLED' };
  }
  return { allowed: true };
}

// Test-only helpers
export function __clearBotJwksCacheForTests(): void {
  botJwksCache = null;
}

export async function decryptMicrosoftTeamsSecret(value: string): Promise<string> {
  return decryptStoredSecret(value);
}
