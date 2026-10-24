import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { ScimFailure } from './validation';

let cachedOrigin: { origin: string; expiresAt: number } | null = null;
const CACHE_TTL_MS = 60_000;

export function clearScimOriginCache(): void {
  cachedOrigin = null;
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
 * Checks whether an origin is a non-public loopback / bind address.
 */
export function isNonPublicOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    const lower = hostname.toLowerCase();
    return (
      lower === 'localhost' ||
      lower === '127.0.0.1' ||
      lower === '0.0.0.0' ||
      lower === '[::1]' ||
      lower.endsWith('.localhost')
    );
  } catch {
    return true;
  }
}

/**
 * Resolve the authoritative canonical public origin for all SCIM endpoints.
 * Explicitly ignores untrusted client-supplied host / forwarded headers to prevent
 * host poisoning or internal listener address leaks (e.g. 0.0.0.0:3000 behind reverse proxies).
 *
 * Priority:
 * 1. Database configuration (SystemSettings.appUrl)
 * 2. NEXT_PUBLIC_APP_URL environment variable
 * 3. NEXTAUTH_URL environment variable
 *
 * In production:
 * - Rejects loopback / non-public origins with an explicit configuration error.
 * - Discovery metadata is backed by an in-memory 60s cache and gracefully falls back
 *   to environment configuration when the database is degraded.
 */
export async function resolveScimPublicOrigin(): Promise<string> {
  const now = Date.now();
  if (cachedOrigin && now < cachedOrigin.expiresAt) {
    return cachedOrigin.origin;
  }

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
    if (!resolved || isNonPublicOrigin(resolved)) {
      throw new ScimFailure(
        500,
        'SCIM public origin is not configured. Configure a public HTTPS application URL in System Settings, NEXT_PUBLIC_APP_URL, or NEXTAUTH_URL.'
      );
    }
    cachedOrigin = { origin: resolved, expiresAt: now + CACHE_TTL_MS };
    return resolved;
  }

  // Non-production fallback (local dev & testing)
  const fallback = resolved ?? 'http://localhost:3000';
  cachedOrigin = { origin: fallback, expiresAt: now + CACHE_TTL_MS };
  return fallback;
}
