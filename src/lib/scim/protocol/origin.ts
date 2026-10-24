import { isIP } from 'node:net';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { isPrivateIp } from '@/lib/network-security';
import { ScimFailure } from './validation';

let cachedOrigin: { origin: string; expiresAt: number } | null = null;
let inFlightLookup: Promise<string> | null = null;
const CACHE_TTL_MS = 60_000;

export function clearScimOriginCache(): void {
  cachedOrigin = null;
  inFlightLookup = null;
}

/**
 * Validates and extracts purely the scheme + host + optional port from a URL string.
 * Strips any pathname, search query, or hash fragment. Rejects non-HTTP(S) protocols
 * and user credentials.
 */
export function parseStrictOrigin(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Checks whether an origin points to a private, loopback, link-local, or bind destination,
 * covering both IPv4/IPv6 address forms and internal hostname patterns.
 */
export function isNonPublicDestination(origin: string): boolean {
  try {
    const url = new URL(origin);
    const rawHost = url.hostname.toLowerCase();
    const cleanHost = rawHost.replace(/^\[|\]$/g, '');

    // Common local/private hostnames
    if (
      cleanHost === 'localhost' ||
      cleanHost === '0.0.0.0' ||
      cleanHost.endsWith('.localhost') ||
      cleanHost.endsWith('.local') ||
      cleanHost.endsWith('.internal') ||
      cleanHost.endsWith('.lan') ||
      cleanHost.endsWith('.localdomain')
    ) {
      return true;
    }

    // IP validation via comprehensive network-security utility
    if (isIP(cleanHost)) {
      return isPrivateIp(cleanHost);
    }

    return false;
  } catch {
    return true;
  }
}

/**
 * Validate origin for production safety.
 * In production:
 * - Public production SCIM URLs must use HTTPS.
 * - Private/loopback/link-local destinations are rejected unless explicitly allowed
 *   under a documented secure private network policy (SCIM_ALLOW_PRIVATE_NETWORK=true).
 */
export function validateProductionOrigin(origin: string): void {
  const allowPrivate = process.env.SCIM_ALLOW_PRIVATE_NETWORK === 'true';
  const allowInsecureHttp = process.env.SCIM_ALLOW_INSECURE_HTTP === 'true';

  const url = new URL(origin);

  if (url.protocol !== 'https:' && !allowInsecureHttp && !allowPrivate) {
    throw new ScimFailure(
      500,
      'An internal error occurred resolving the SCIM service configuration.'
    );
  }

  if (isNonPublicDestination(origin) && !allowPrivate) {
    throw new ScimFailure(
      500,
      'An internal error occurred resolving the SCIM service configuration.'
    );
  }
}

async function performOriginLookup(): Promise<string> {
  let dbOrigin: string | null = null;
  try {
    if (prisma?.systemSettings?.findUnique) {
      const settings = await prisma.systemSettings.findUnique({
        where: { id: 'default' },
        select: { appUrl: true },
      });
      dbOrigin = parseStrictOrigin(settings?.appUrl);
    }
  } catch (error) {
    logger.warn(
      'Failed to query SystemSettings for SCIM public origin, falling back to environment',
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    );
  }

  const envPublic = parseStrictOrigin(process.env.NEXT_PUBLIC_APP_URL);
  const envAuth = parseStrictOrigin(process.env.NEXTAUTH_URL);

  const resolved = dbOrigin ?? envPublic ?? envAuth;

  if (process.env.NODE_ENV === 'production') {
    if (!resolved) {
      logger.error(
        'SCIM public origin resolution failed: no public URL configured in SystemSettings, NEXT_PUBLIC_APP_URL, or NEXTAUTH_URL.'
      );
      throw new ScimFailure(
        500,
        'An internal error occurred resolving the SCIM service configuration.'
      );
    }

    try {
      validateProductionOrigin(resolved);
    } catch (err) {
      logger.error('SCIM public origin validation failed in production', {
        resolved,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    cachedOrigin = { origin: resolved, expiresAt: Date.now() + CACHE_TTL_MS };
    return resolved;
  }

  // Non-production fallback (local dev & testing)
  const fallback = resolved ?? 'http://localhost:3000';
  cachedOrigin = { origin: fallback, expiresAt: Date.now() + CACHE_TTL_MS };
  return fallback;
}

/**
 * Resolve the authoritative canonical public origin for all SCIM endpoints.
 * Explicitly ignores untrusted client-supplied host / forwarded headers to prevent
 * host poisoning or internal listener address leaks (e.g. 0.0.0.0:3000 behind reverse proxies).
 *
 * Concurrent requests on a cold cache share an in-flight promise to avoid duplicate
 * database queries.
 */
export async function resolveScimPublicOrigin(): Promise<string> {
  const now = Date.now();
  if (cachedOrigin && now < cachedOrigin.expiresAt) {
    return cachedOrigin.origin;
  }

  if (inFlightLookup) {
    return inFlightLookup;
  }

  inFlightLookup = performOriginLookup().finally(() => {
    inFlightLookup = null;
  });

  return inFlightLookup;
}
