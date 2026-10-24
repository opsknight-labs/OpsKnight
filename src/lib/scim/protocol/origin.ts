import { getAppUrl } from '@/lib/app-url';

/**
 * Resolve the authoritative canonical public origin for all SCIM endpoints.
 * Explicitly ignores untrusted client-supplied host / forwarded headers to prevent
 * host poisoning or internal listener address leaks (e.g. 0.0.0.0:3000 behind reverse proxies).
 *
 * Priority:
 * 1. Database configuration (SystemSettings.appUrl)
 * 2. APP_URL / NEXT_PUBLIC_APP_URL environment variable
 * 3. NEXTAUTH_URL environment variable
 * 4. Fallback (localhost)
 */
export async function resolveScimPublicOrigin(): Promise<string> {
  const url = await getAppUrl();
  return url.replace(/\/+$/, '');
}
