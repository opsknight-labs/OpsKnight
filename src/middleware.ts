import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { logger } from '@/lib/logger';
import { getNextAuthSecret } from '@/lib/secret-manager';
import { SESSION_TOKEN_COOKIE_NAME, useSecureCookies } from '@/lib/auth-cookies';
import { safeInternalCallbackUrl } from '@/lib/auth-redirect';
import { toMobilePath } from '@/lib/app-routes';
import { statusDomainRequestHeaders } from '@/lib/status-pages/internal-request';
import {
  PRIVATE_STATUS_CACHE_CONTROL,
  PUBLIC_STATUS_CACHE_CONTROL,
} from '@/lib/status-pages/cache-policy';
import {
  matchesStatusPageDomain,
  extractSubdomainFromHost,
} from '@/lib/status-pages/status-route-resolver';
import {
  normalizeHostname,
  parseHostname,
  getAuthoritativeRequestHost,
} from '@/lib/request-host';
import { parse as parseDomain } from 'tldts';

const PUBLIC_PATH_PREFIXES = [
  '/login',
  '/forgot-password',
  '/reset-password',
  '/set-password',
  '/api/auth',
  '/api/health',
  '/api/events',
  '/api/logs/ingest',
  '/api/status',
  '/api/status-page',
  '/api/system/vapid-public-key',
  '/api/slack/actions',
  '/api/slack/oauth/callback',
  '/api/integrations',
  '/status',
  '/setup',
  '/m/login',
  '/m/forgot-password',
  '/m/reset-password',
];

function isMobileUserAgent(userAgent: string | null): boolean {
  if (!userAgent) {
    logger.info('Mobile detection: No user agent');
    return false;
  }
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i.test(
      userAgent
    );
  logger.info('Mobile detection', { userAgent, isMobile });
  return isMobile;
}

const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '')
  .split(',')
  .map(value => value.trim())
  .filter(Boolean);
const STATUS_DOMAIN_CACHE_TTL = Number(process.env.STATUS_PAGE_DOMAIN_CACHE_TTL || 60);
const STATUS_ROUTE_POSITIVE_TTL_MS = 60_000;
const STATUS_ROUTE_NEGATIVE_TTL_MS = 10_000;
const STATUS_ROUTE_MAX_STALE_MS = 5 * 60_000;
const STATUS_ROUTE_CACHE_MAX_ENTRIES = 1_000;

function isPublicPath(pathname: string) {
  if (PUBLIC_PATH_PREFIXES.some(path => pathname === path || pathname.startsWith(`${path}/`))) {
    return true;
  }
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/icon.svg') ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname === '/manifest.webmanifest' ||
    pathname.startsWith('/icons/')
  ) {
    return true;
  }
  return /\.(jpg|jpeg|png|webp|avif|gif|svg|ico|css|js|woff|woff2|ttf|eot|webmanifest)$/i.test(
    pathname
  );
}

export function isStatusDomainPath(pathname: string) {
  return (
    pathname === '/' ||
    pathname === '/subscribe' ||
    pathname.startsWith('/postmortems/') ||
    pathname.startsWith('/verify') ||
    pathname.startsWith('/unsubscribe')
  );
}

export function isStatusStaticAsset(pathname: string): boolean {
  if (pathname.startsWith('/_next/')) return true;
  if (
    pathname === '/favicon.ico' ||
    pathname === '/icon.svg' ||
    pathname === '/apple-icon.png' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml' ||
    pathname === '/manifest.webmanifest'
  ) {
    return true;
  }
  if (
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/images/') ||
    pathname.startsWith('/fonts/')
  ) {
    return /\.(jpg|jpeg|png|webp|avif|gif|svg|ico|woff|woff2|ttf|eot)$/i.test(pathname);
  }
  return false;
}

const STATUS_API_EXACT_GET = new Set([
  '/api/status',
  '/api/status/history',
  '/api/status/rss',
  '/api/status/uptime-export',
]);

const STATUS_API_EXACT_POST = new Set([
  '/api/status/subscribe',
  '/api/status-page/subscribe',
  '/api/status/subscriptions/verify',
  '/api/status/subscriptions/unsubscribe',
]);

const STATUS_SLUG_API_REGEX =
  /^\/api\/status\/[a-z0-9_-]+(\/(history|rss|uptime-export|subscribe))?$/;

const RESERVED_STATUS_API_SLUGS = new Set([
  'admin',
  'api',
  'auth',
  'internal',
  'manage',
  'settings',
  'users',
  'subscriptions',
]);

export function isAllowedStatusApi(pathname: string, method: string): boolean {
  if (method === 'GET') {
    if (STATUS_API_EXACT_GET.has(pathname)) return true;
    if (pathname.startsWith('/api/status-page/logo/')) return true;
    if (pathname.startsWith('/api/status/')) {
      const firstSegment = pathname.slice('/api/status/'.length).split('/')[0];
      if (firstSegment && RESERVED_STATUS_API_SLUGS.has(firstSegment)) return false;
    }
    if (STATUS_SLUG_API_REGEX.test(pathname) && !pathname.endsWith('/subscribe')) return true;
    return false;
  }

  if (method === 'POST') {
    if (STATUS_API_EXACT_POST.has(pathname)) return true;
    if (pathname.startsWith('/api/status/')) {
      const firstSegment = pathname.slice('/api/status/'.length).split('/')[0];
      if (firstSegment && RESERVED_STATUS_API_SLUGS.has(firstSegment)) return false;
    }
    if (STATUS_SLUG_API_REGEX.test(pathname) && pathname.endsWith('/subscribe')) return true;
    return false;
  }

  return false;
}

// Re-export shared host utilities for external consumers
export { normalizeHostname, parseHostname, getAuthoritativeRequestHost } from '@/lib/request-host';

/**
 * Returns true when the request targets the one-time bootstrap setup page
 * (/setup) or its Server Action POST. This is the minimal surface that
 * must be allowed on an unknown host during initial installation, before
 * SystemSettings.appUrl has been seeded.
 *
 * The existing bootstrap code mechanism (expiring one-time operator capability,
 * rate-limited, consumed once, refused when a user already exists) protects
 * this endpoint.
 */
export function isBootstrapSetupRequest(pathname: string, method: string): boolean {
  if (pathname !== '/setup') return false;
  const upper = (method || '').toUpperCase();
  return upper === 'GET' || upper === 'HEAD' || upper === 'POST';
}

export function getHostWithAliases(hostname: string): string[] {
  const clean = normalizeHostname(hostname);
  if (!clean) return [];
  const hosts = new Set<string>([clean]);
  if (
    clean === 'localhost' ||
    clean === '127.0.0.1' ||
    clean === '[::1]' ||
    clean.endsWith('.localhost')
  ) {
    return Array.from(hosts);
  }

  // Use tldts to symmetrically pair genuine apex domains (e.g. opsnite.com ↔ www.opsnite.com,
  // example.co.uk ↔ www.example.co.uk) without pairing arbitrary subdomains in either direction
  // (e.g. app.opsnite.com or www.app.opsnite.com).
  const parsed = parseDomain(clean);
  if (parsed.domain) {
    if (parsed.subdomain === '') {
      // Genuine apex domain -> pair with www.<apex>
      hosts.add(`www.${clean}`);
    } else if (parsed.subdomain === 'www') {
      // Genuine www.<apex> domain -> pair with apex
      hosts.add(parsed.domain);
    }
  }

  return Array.from(hosts);
}

export function getAllowedAppHosts(canonicalAppHost?: string | null): Set<string> {
  const allowed = new Set<string>([
    'localhost',
    '127.0.0.1',
    '[::1]',
  ]);

  // Canonical sources get automatic www ↔ apex alias generation
  const canonicalSources: (string | null | undefined)[] = [
    canonicalAppHost,
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXTAUTH_URL,
  ];

  for (const candidate of canonicalSources) {
    if (!candidate) continue;
    const parsed = parseHostname(candidate);
    if (parsed) {
      for (const host of getHostWithAliases(parsed)) {
        allowed.add(host);
      }
    }
  }

  // Explicit aliases are exact — no automatic www pairing
  if (process.env.APP_HOST_ALIASES) {
    for (const alias of process.env.APP_HOST_ALIASES.split(',')) {
      const parsed = parseHostname(alias.trim());
      if (parsed) {
        allowed.add(parsed);
      }
    }
  }

  return allowed;
}

export function isAllowedApplicationHost(
  hostname: string,
  canonicalAppHost?: string | null
): boolean {
  if (!hostname) return false;
  const clean = normalizeHostname(hostname);
  if (!clean) return false;
  if (
    clean === 'localhost' ||
    clean === '127.0.0.1' ||
    clean === '[::1]' ||
    clean.endsWith('.localhost')
  ) {
    return true;
  }
  const allowed = getAllowedAppHosts(canonicalAppHost);
  return allowed.has(clean);
}

export const isRecognizedAppHost = isAllowedApplicationHost;

export function getCanonicalApplicationHost(statusConfigAppHost?: string | null): string {
  const candidate =
    statusConfigAppHost ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    'localhost';
  return parseHostname(candidate) || 'localhost';
}

export function shouldRedirectToCanonicalAppHost(
  requestHost: string,
  canonicalHost: string,
  pathname: string,
  method: string
): boolean {
  if (process.env.REDIRECT_TO_CANONICAL_HOST === 'false') return false;
  if (!requestHost || !canonicalHost) return false;
  if (requestHost === canonicalHost) return false;
  if (
    requestHost === 'localhost' ||
    requestHost === '127.0.0.1' ||
    requestHost.endsWith('.localhost') ||
    canonicalHost === 'localhost' ||
    canonicalHost === '127.0.0.1' ||
    canonicalHost.endsWith('.localhost')
  ) {
    return false;
  }
  if (pathname === '/api/status-page/domains' || pathname === '/api/health') {
    return false;
  }
  if (method !== 'GET' && method !== 'HEAD') {
    return false;
  }
  const isWwwPair =
    requestHost === `www.${canonicalHost}` || canonicalHost === `www.${requestHost}`;
  return isWwwPair;
}

const DEFAULT_APP_HOST =
  process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';

const INTERNAL_API_BASE =
  process.env.INTERNAL_API_URL ||
  (process.env.PORT ? `http://127.0.0.1:${process.env.PORT}` : 'http://127.0.0.1:3000');

function usesExternalStatusServingStore(): boolean {
  return (
    process.env.STATUS_PAGE_EXTERNAL_SERVING_STORE === 'true' &&
    Boolean(process.env.STATUS_PAGE_SERVING_STORE_URL?.trim()) &&
    Boolean(process.env.STATUS_PAGE_SERVING_STORE_TOKEN?.trim())
  );
}

type StatusDomainPage = {
  id: string;
  slug?: string | null;
  isDefault?: boolean;
  subdomain?: string | null;
  customDomain?: string | null;
  requireAuth?: boolean;
};
type PublishedStatusRoute = {
  pageId: string;
  slug: string | null;
  requireAuth: boolean;
  revision: string;
};
type StatusDomainConfig = {
  enabled: boolean;
  pages?: StatusDomainPage[];
  appHost?: string | null;
};
type CachedDomainConfig = {
  value: StatusDomainConfig | null;
  expiresAt: number;
};
let cachedStatusDomain: CachedDomainConfig | null = null;
let inflightStatusDomainFetch: Promise<StatusDomainConfig | null> | null = null;

async function fetchStatusDomainConfig(forceRefresh = false): Promise<StatusDomainConfig | null> {
  const now = Date.now();
  if (!forceRefresh && cachedStatusDomain && cachedStatusDomain.expiresAt > now) return cachedStatusDomain.value;
  if (!forceRefresh && inflightStatusDomainFetch) return inflightStatusDomainFetch;

  inflightStatusDomainFetch = (async () => {
    try {
      const response = await fetch(`${INTERNAL_API_BASE}/api/status-page/domains`, {
        cache: 'no-store',
        headers: await statusDomainRequestHeaders(),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error('Status domain configuration unavailable');
      const value = (await response.json()) as StatusDomainConfig;
      cachedStatusDomain = {
        value,
        expiresAt: Date.now() + STATUS_DOMAIN_CACHE_TTL * 1000,
      };
      return value;
    } catch {
      cachedStatusDomain = {
        value: cachedStatusDomain?.value ?? null,
        expiresAt: Date.now() + Math.min(STATUS_DOMAIN_CACHE_TTL, 10) * 1000,
      };
      return cachedStatusDomain.value;
    } finally {
      inflightStatusDomainFetch = null;
    }
  })();
  return inflightStatusDomainFetch;
}

type CachedPublishedRoute = {
  value: PublishedStatusRoute | null;
  expiresAt: number;
  staleUntil: number;
};
const publishedRouteCache = new Map<string, CachedPublishedRoute>();
const publishedRouteInflight = new Map<string, Promise<PublishedStatusRoute | null>>();

function cachePublishedRoute(routeKey: string, entry: CachedPublishedRoute): void {
  if (
    !publishedRouteCache.has(routeKey) &&
    publishedRouteCache.size >= STATUS_ROUTE_CACHE_MAX_ENTRIES
  ) {
    const oldestKey = publishedRouteCache.keys().next().value;
    if (oldestKey) publishedRouteCache.delete(oldestKey);
  }
  publishedRouteCache.set(routeKey, entry);
}

function isSafeStatusSlug(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 128 &&
    value.split('-').every(part => part.length > 0 && /^[a-z0-9]+$/.test(part))
  );
}

export function parsePublishedStatusRoute(value: unknown): PublishedStatusRoute | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).some(key => !['pageId', 'slug', 'requireAuth', 'revision'].includes(key))
  ) {
    return null;
  }
  const slug = record.slug === null ? null : record.slug;
  if (
    typeof record.pageId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(record.pageId) ||
    (typeof slug !== 'string' && slug !== null) ||
    (typeof slug === 'string' && !isSafeStatusSlug(slug)) ||
    typeof record.requireAuth !== 'boolean' ||
    typeof record.revision !== 'string' ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(record.revision)
  ) {
    return null;
  }
  return {
    pageId: record.pageId as string,
    slug: slug as string | null,
    requireAuth: record.requireAuth as boolean,
    revision: record.revision as string,
  };
}

export function externalRouteKey(hostname: string, appHost?: string | null): string {
  const subdomain = extractSubdomainFromHost(hostname, appHost || DEFAULT_APP_HOST);
  if (subdomain && isSafeStatusSlug(subdomain)) return `subdomain:${subdomain}`;
  return `domain:${hostname}`;
}

export async function fetchPublishedStatusDomain(
  hostname: string
): Promise<PublishedStatusRoute | null> {
  const base = process.env.STATUS_PAGE_SERVING_STORE_URL?.trim();
  const token = process.env.STATUS_PAGE_SERVING_STORE_TOKEN?.trim();
  if (!base || !token || process.env.STATUS_PAGE_EXTERNAL_SERVING_STORE !== 'true') return null;
  const routeKey = externalRouteKey(hostname);
  const now = Date.now();
  const cached = publishedRouteCache.get(routeKey);
  if (cached && cached.expiresAt > now) return cached.value;
  const inflight = publishedRouteInflight.get(routeKey);
  if (inflight) return inflight;

  const request = (async () => {
    try {
      const origin = new URL(base);
      if (origin.protocol !== 'https:' || origin.username || origin.password) return null;
      const storeBase = origin.pathname.endsWith('/')
        ? origin
        : new URL(`${origin.pathname}/`, origin);
      const response = await fetch(
        new URL(`status-pages/routes/${encodeURIComponent(routeKey)}`, storeBase),
        {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
          signal: AbortSignal.timeout(2000),
        }
      );
      if (!response.ok && response.status !== 404) throw new Error('Status route lookup failed');
      let value = response.status === 404 ? null : parsePublishedStatusRoute(await response.json());

      // Fallback for well-known "status" subdomain to default route if not explicitly published under subdomain:status
      if (!value && routeKey === 'subdomain:status') {
        try {
          const defaultResponse = await fetch(new URL('status-pages/routes/default', storeBase), {
            headers: { Authorization: `Bearer ${token}` },
            cache: 'no-store',
            signal: AbortSignal.timeout(2000),
          });
          if (defaultResponse.ok) {
            value = parsePublishedStatusRoute(await defaultResponse.json());
          }
        } catch {
          // ignore fallback error
        }
      }

      if (response.status !== 404 && !value) throw new Error('Invalid status route payload');
      const cachedAt = Date.now();
      cachePublishedRoute(routeKey, {
        value,
        expiresAt: cachedAt + (value ? STATUS_ROUTE_POSITIVE_TTL_MS : STATUS_ROUTE_NEGATIVE_TTL_MS),
        staleUntil: cachedAt + (value ? STATUS_ROUTE_MAX_STALE_MS : STATUS_ROUTE_NEGATIVE_TTL_MS),
      });
      return value;
    } catch {
      if (cached?.value && cached.staleUntil > Date.now()) {
        cachePublishedRoute(routeKey, {
          value: cached.value,
          expiresAt: Math.min(Date.now() + STATUS_ROUTE_NEGATIVE_TTL_MS, cached.staleUntil),
          staleUntil: cached.staleUntil,
        });
        return cached.value;
      }
      publishedRouteCache.delete(routeKey);
      return null;
    } finally {
      publishedRouteInflight.delete(routeKey);
    }
  })();
  publishedRouteInflight.set(routeKey, request);
  return request;
}

function getSecurityHeaders(): Record<string, string> {
  const isProduction = process.env.NODE_ENV === 'production';
  const scriptSource = isProduction
    ? "script-src 'self' 'unsafe-inline'"
    : "script-src 'self' 'unsafe-eval' 'unsafe-inline'";
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'X-XSS-Protection': '0',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': [
      "default-src 'self'",
      scriptSource,
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "manifest-src 'self'",
      "object-src 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join('; '),
    ...(isProduction && {
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    }),
  };
}

function applySensitiveAuthHeaders(response: NextResponse, pathname: string) {
  if (
    pathname === '/reset-password' ||
    pathname === '/m/reset-password' ||
    pathname === '/set-password' ||
    pathname === '/api/auth/reset-password' ||
    pathname === '/api/auth/forgot-password'
  ) {
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Referrer-Policy', 'no-referrer');
  }
}

export function handleStatusDomainRequest({
  req,
  pathname,
  statusRoute,
  securityHeaders,
  forwardedHeaders,
  requestId,
}: {
  req: NextRequest;
  pathname: string;
  statusRoute: { pageId: string; slug: string | null; requireAuth: boolean };
  securityHeaders: Record<string, string>;
  forwardedHeaders: Headers;
  requestId: string;
}): NextResponse {
  // 1. Server Action Firewall: Reject all Next-Action requests on status domains unconditionally (highest priority)
  if (req.headers.has('next-action')) {
    return new NextResponse('Not Found', { status: 404, headers: securityHeaders });
  }

  // 2. Static Assets Allowlist (GET / HEAD only)
  if (isStatusStaticAsset(pathname)) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new NextResponse('Not Found', { status: 404, headers: securityHeaders });
    }
    const assetResponse = NextResponse.next({ request: { headers: forwardedHeaders } });
    assetResponse.headers.set('x-request-id', requestId);
    Object.entries(securityHeaders).forEach(([key, value]) =>
      assetResponse.headers.set(key, value)
    );
    return assetResponse;
  }

  // 3. Status Auth Callback (runs on status host)
  if (pathname === '/status-auth/callback') {
    const callbackResponse = NextResponse.next({ request: { headers: forwardedHeaders } });
    callbackResponse.headers.set('x-request-id', requestId);
    Object.entries(securityHeaders).forEach(([key, value]) =>
      callbackResponse.headers.set(key, value)
    );
    return callbackResponse;
  }

  // 4. Allowed Status Surface Pages (Rewrite to public status route)
  if (isStatusDomainPath(pathname)) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new NextResponse('Method Not Allowed', {
        status: 405,
        headers: {
          ...securityHeaders,
          Allow: 'GET, HEAD',
        },
      });
    }

    const url = req.nextUrl.clone();
    const pageRoot = statusRoute.slug ? `/status/${statusRoute.slug}` : '/status';
    url.pathname = pathname === '/' || pathname === '' ? pageRoot : `${pageRoot}${pathname}`;
    const rewriteResponse = NextResponse.rewrite(url);
    Object.entries(securityHeaders).forEach(([key, value]) =>
      rewriteResponse.headers.set(key, value)
    );
    rewriteResponse.headers.set('x-request-id', requestId);
    rewriteResponse.headers.set(
      'Cache-Control',
      statusRoute.requireAuth ? PRIVATE_STATUS_CACHE_CONTROL : PUBLIC_STATUS_CACHE_CONTROL
    );
    if (statusRoute.requireAuth) rewriteResponse.headers.set('Vary', 'Cookie');
    return rewriteResponse;
  }

  // 5. Allowed Status APIs
  if (isAllowedStatusApi(pathname, req.method)) {
    const apiResponse = NextResponse.next({ request: { headers: forwardedHeaders } });
    apiResponse.headers.set('x-request-id', requestId);
    Object.entries(securityHeaders).forEach(([key, value]) => apiResponse.headers.set(key, value));
    return apiResponse;
  }

  // 6. NO FALLTHROUGH: Any other path (/users, /settings, /incidents, /admin, /setup, /login, /api/auth, etc.)
  return new NextResponse('Not Found', { status: 404, headers: securityHeaders });
}

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const origin = req.headers.get('origin');
  const suppliedRequestId = req.headers.get('x-request-id')?.trim();
  const requestId =
    suppliedRequestId && /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId)
      ? suppliedRequestId
      : crypto.randomUUID();
  const forwardedHeaders = new Headers(req.headers);
  forwardedHeaders.set('x-request-id', requestId);

  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  response.headers.set('x-request-id', requestId);
  const securityHeaders = getSecurityHeaders();
  Object.entries(securityHeaders).forEach(([key, value]) => response.headers.set(key, value));
  applySensitiveAuthHeaders(response, pathname);

  const requestHost = getAuthoritativeRequestHost(req);

  // Internal status-domain configuration provider: bypass to avoid recursive middleware deadlock
  if (pathname === '/api/status-page/domains' && isAllowedApplicationHost(requestHost)) {
    return response;
  }

  // 1. Resolve status route strictly using the authoritative request host
  const publishedPage = requestHost ? await fetchPublishedStatusDomain(requestHost) : null;

  let statusConfig: StatusDomainConfig | null = null;
  if (!publishedPage && !usesExternalStatusServingStore()) {
    statusConfig = await fetchStatusDomainConfig();
  }

  let matchedPage: StatusDomainPage | null = null;
  if (!publishedPage && statusConfig?.enabled && requestHost) {
    // 1st priority: explicit customDomain or explicit subdomain match
    matchedPage =
      statusConfig.pages?.find(page => {
        const customHost = parseHostname(page.customDomain);
        if (customHost && requestHost === customHost) return true;
        if (page.subdomain) {
          const cleanSub = parseHostname(page.subdomain);
          if (cleanSub && requestHost === cleanSub) return true;
          if (statusConfig?.appHost) {
            const extracted = extractSubdomainFromHost(requestHost, statusConfig.appHost);
            if (extracted && extracted === cleanSub) return true;
          }
        }
        return false;
      }) ?? null;

    // 2nd priority: general status route matching (slug, default status page fallback)
    if (!matchedPage) {
      matchedPage =
        statusConfig.pages?.find(page =>
          matchesStatusPageDomain(page, requestHost, statusConfig?.appHost)
        ) ?? null;
    }
  }

  const statusRoute = publishedPage
    ? {
        pageId: publishedPage.pageId,
        slug: publishedPage.slug,
        requireAuth: publishedPage.requireAuth,
      }
    : matchedPage
      ? {
          pageId: matchedPage.id,
          slug: matchedPage.slug ?? null,
          requireAuth: !!matchedPage.requireAuth,
        }
      : null;

  if (statusRoute) {
    return handleStatusDomainRequest({
      req,
      pathname,
      statusRoute,
      securityHeaders,
      forwardedHeaders,
      requestId,
    });
  }

  // 2. Bootstrap setup exception: allow /setup on unknown hosts for initial installation.
  //    Status domain already handled above (returns 404 for /setup via firewall).
  //    The existing secure bootstrap code mechanism (one-time operator capability,
  //    rate-limited, consumed once, refuses when a user already exists) protects
  //    this endpoint. Once bootstrap completes, SystemSettings.appUrl is seeded
  //    and the host becomes recognized — closing this exception permanently.
  if (isBootstrapSetupRequest(pathname, req.method)) {
    return response;
  }

  // 3. Validate authoritative request host as an allowed application host
  if (!isAllowedApplicationHost(requestHost, statusConfig?.appHost)) {
    // If not recognized against static env hosts or cached config, force-refresh
    // DB-backed host config once before returning 421. This handles:
    // 1) First login immediately after /setup (cache previously had appHost = null)
    // 2) Domain changes from Settings -> Application URL
    statusConfig = await fetchStatusDomainConfig(true);
    if (!isAllowedApplicationHost(requestHost, statusConfig?.appHost)) {
      return new NextResponse('Misdirected Request', { status: 421, headers: securityHeaders });
    }
  }

  // 4. Canonical host 308 redirection for domain aliases (e.g. opsnite.com -> www.opsnite.com)
  const canonicalHost = getCanonicalApplicationHost(statusConfig?.appHost);
  if (shouldRedirectToCanonicalAppHost(requestHost, canonicalHost, pathname, req.method)) {
    const canonicalUrl = req.nextUrl.clone();
    // Preserve request port if non-standard (e.g. port 3100), unless canonical host explicitly defines a port
    if (canonicalHost.includes(':')) {
      canonicalUrl.host = canonicalHost;
    } else {
      canonicalUrl.hostname = canonicalHost;
    }

    // Gate forwarded protocol strictly behind TRUST_PROXY_HEADERS
    let validatedProto = req.nextUrl.protocol.replace(':', '');
    if (process.env.TRUST_PROXY_HEADERS === 'true') {
      const forwardedProto = req.headers
        .get('x-forwarded-proto')
        ?.split(',')[0]
        ?.trim()
        .toLowerCase();
      if (forwardedProto === 'http' || forwardedProto === 'https') {
        validatedProto = forwardedProto;
      }
    }
    canonicalUrl.protocol = `${validatedProto}:`;

    const redirectResponse = NextResponse.redirect(canonicalUrl, { status: 308 });
    Object.entries(securityHeaders).forEach(([key, value]) =>
      redirectResponse.headers.set(key, value)
    );
    return redirectResponse;
  }

  // Old mobile reset links remain valid but converge on the single responsive page.
  if (pathname === '/m/reset-password') {
    const resetUrl = req.nextUrl.clone();
    resetUrl.pathname = '/reset-password';
    const redirectResponse = NextResponse.redirect(resetUrl);
    Object.entries(securityHeaders).forEach(([key, value]) =>
      redirectResponse.headers.set(key, value)
    );
    applySensitiveAuthHeaders(redirectResponse, '/reset-password');
    return redirectResponse;
  }

  const userAgent = req.headers.get('user-agent');
  const isMobile = isMobileUserAgent(userAgent);
  const preferDesktop = req.cookies.get('prefer-desktop')?.value === 'true';
  const mobileDestination = toMobilePath(pathname);
  const shouldRedirectToMobile =
    isMobile &&
    !preferDesktop &&
    Boolean(mobileDestination) &&
    !pathname.startsWith('/m') &&
    !pathname.startsWith('/api') &&
    !pathname.startsWith('/setup') &&
    !pathname.startsWith('/set-password') &&
    !pathname.startsWith('/reset-password') &&
    !pathname.startsWith('/status/verify') &&
    !pathname.startsWith('/status/unsubscribe') &&
    !pathname.startsWith('/status') &&
    !pathname.startsWith('/_next') &&
    !pathname.startsWith('/favicon') &&
    !/\.(jpg|jpeg|png|webp|avif|gif|svg|ico|css|js|woff|woff2|ttf|eot|webmanifest)$/i.test(
      pathname
    );

  if (shouldRedirectToMobile && mobileDestination) {
    const mobileUrl = req.nextUrl.clone();
    mobileUrl.pathname = mobileDestination;
    const redirectResponse = NextResponse.redirect(mobileUrl);
    Object.entries(securityHeaders).forEach(([key, value]) =>
      redirectResponse.headers.set(key, value)
    );
    return redirectResponse;
  }

  if (pathname.startsWith('/api')) {
    const originAllowed = origin && CORS_ALLOWED_ORIGINS.includes(origin);
    if (originAllowed) {
      const corsHeaders = {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-API-Key',
        'Access-Control-Allow-Credentials': 'true',
        Vary: 'Origin',
      };
      if (req.method === 'OPTIONS')
        return new NextResponse(null, { status: 204, headers: corsHeaders });
      const apiResponse = NextResponse.next({ request: { headers: forwardedHeaders } });
      apiResponse.headers.set('x-request-id', requestId);
      Object.entries(corsHeaders).forEach(([key, value]) => apiResponse.headers.set(key, value));
      Object.entries(securityHeaders).forEach(([key, value]) =>
        apiResponse.headers.set(key, value)
      );
      applySensitiveAuthHeaders(apiResponse, pathname);
      return apiResponse;
    }
    return response;
  }

  if (pathname === '/status' || pathname.startsWith('/status/')) {
    const isActionPath =
      pathname.includes('/verify/') ||
      pathname.includes('/unsubscribe/') ||
      pathname.includes('/postmortems/');
    const slug = pathname.split('/')[2] || null;
    const statusConfig = isActionPath ? null : await fetchStatusDomainConfig();
    const page = statusConfig?.pages?.find(candidate =>
      slug ? candidate.slug === slug : candidate.isDefault
    );
    response.headers.set(
      'Cache-Control',
      !page || page.requireAuth || isActionPath
        ? PRIVATE_STATUS_CACHE_CONTROL
        : PUBLIC_STATUS_CACHE_CONTROL
    );
    if (!page || page.requireAuth || isActionPath) response.headers.set('Vary', 'Cookie');
  }

  const token = await getToken({
    req,
    secret: await getNextAuthSecret(),
    cookieName: SESSION_TOKEN_COOKIE_NAME,
    secureCookie: useSecureCookies,
  });
  const isSessionExpired =
    typeof (token as { sessionExpiresAt?: unknown })?.sessionExpiresAt === 'number' &&
    Date.now() >= (token as { sessionExpiresAt: number }).sessionExpiresAt * 1000;
  const isAuthenticated = !!token && !token.error && !!token.sub && !isSessionExpired;

  if (isAuthenticated) {
    const isLoginPage =
      pathname === '/login' ||
      pathname.startsWith('/login/') ||
      pathname === '/m/login' ||
      pathname.startsWith('/m/login/');
    if (isLoginPage) {
      if (req.nextUrl.searchParams.has('error')) return response;
      const isExplicitMobile = pathname === '/m/login' || pathname.startsWith('/m/login/');
      const defaultDest = isExplicitMobile || (isMobile && !preferDesktop) ? '/m' : '/';
      const redirectUrl = safeInternalCallbackUrl(
        req.nextUrl.searchParams.get('callbackUrl'),
        defaultDest
      );
      const redirectResponse = NextResponse.redirect(new URL(redirectUrl, req.url));
      Object.entries(securityHeaders).forEach(([key, value]) =>
        redirectResponse.headers.set(key, value)
      );
      return redirectResponse;
    }
    return response;
  }

  if (isPublicPath(pathname)) return response;

  const url = req.nextUrl.clone();
  url.pathname = pathname.startsWith('/m') || (isMobile && !preferDesktop) ? '/m/login' : '/login';
  url.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
  const redirectResponse = NextResponse.redirect(url);
  redirectResponse.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  redirectResponse.headers.set('Pragma', 'no-cache');
  Object.entries(securityHeaders).forEach(([key, value]) =>
    redirectResponse.headers.set(key, value)
  );
  return redirectResponse;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
