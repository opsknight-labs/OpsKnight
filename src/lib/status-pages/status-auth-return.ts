import { z } from 'zod/v3';

/**
 * Return-target encoding for the status-page SSO hand-off.
 *
 * A status page on its own domain sends logged-out viewers to the app host at
 * `/status-auth/start`. The return target travels as a bare host, an optional
 * scheme word and a relative path, never as a full URL: WAFs block absolute
 * URLs to another domain in query strings as remote file inclusion (OWASP CRS
 * 931120/931130, AWS GenericRFI_QUERYARGUMENTS), and the URL got encoded a
 * second time when the start route bounced logged-out users through login.
 */

// Host characters only (name, IPv6 brackets, port). The parsed-URL host
// comparison below is the real check; this keeps userinfo, paths and odd bytes out.
const HOST_PATTERN = /^[A-Za-z0-9.:[\]-]{1,260}$/;

/** Strict query contract for `/status-auth/start`, current and legacy forms. */
export const statusAuthStartQuerySchema = z
  .object({
    pageId: z.string().trim().min(1).max(128),
    returnHost: z.string().trim().max(260).optional(),
    returnScheme: z.enum(['http', 'https']).optional(),
    returnTo: z.string().trim().max(2048).optional(),
  })
  .strict();

export type StatusAuthStartQuery = z.infer<typeof statusAuthStartQuerySchema>;

export function statusAuthStartUrl(
  appUrl: string,
  target: { pageId: string; host: string; scheme?: string | null; path?: string }
): string {
  const params = new URLSearchParams({ pageId: target.pageId, returnHost: target.host });
  if (target.scheme === 'http') params.set('returnScheme', 'http');
  if (target.path && target.path !== '/') params.set('returnTo', target.path);
  // `/` is legal in a query value. Leaving it unescaped keeps the path from
  // being encoded twice (`%252F`) when the start route nests this query in
  // the login callbackUrl.
  return `${appUrl}/status-auth/start?${params.toString().replace(/%2F/gi, '/')}`;
}

/**
 * Rebuilds the absolute return URL from the start route's query. Accepts the
 * current `returnHost` form and the legacy absolute `returnTo` form, so links
 * issued before the change keep working. Host allow-listing stays with the
 * caller. Returns null for anything malformed.
 */
export function resolveStatusAuthReturn(query: StatusAuthStartQuery, appUrl: string): URL | null {
  const returnHost = query.returnHost;
  const returnTo = query.returnTo || '/';

  if (!returnHost) {
    try {
      return new URL(returnTo, appUrl);
    } catch {
      return null;
    }
  }

  if (!HOST_PATTERN.test(returnHost)) return null;
  if (!returnTo.startsWith('/') || returnTo.startsWith('//') || returnTo.includes('\\')) {
    return null;
  }
  const scheme = query.returnScheme === 'http' ? 'http' : 'https';
  try {
    const url = new URL(`${scheme}://${returnHost}${returnTo}`);
    const expected = returnHost.toLowerCase();
    const defaultPort = scheme === 'https' ? ':443' : ':80';
    return url.host === expected || `${url.host}${defaultPort}` === expected ? url : null;
  } catch {
    return null;
  }
}
