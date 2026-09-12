import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { logger } from '@/lib/logger';
import { getNextAuthSecret } from '@/lib/secret-manager';
import { SESSION_TOKEN_COOKIE_NAME, useSecureCookies } from '@/lib/auth-cookies';
import { safeInternalCallbackUrl } from '@/lib/auth-redirect';
import { statusDomainRequestHeaders } from '@/lib/status-pages/internal-request';
import {
  PRIVATE_STATUS_CACHE_CONTROL,
  PUBLIC_STATUS_CACHE_CONTROL,
} from '@/lib/status-pages/cache-policy';

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

function isStatusDomainPath(pathname: string) {
  return (
    pathname === '/' ||
    pathname === '/history' ||
    pathname === '/subscribe' ||
    pathname.startsWith('/postmortems/') ||
    pathname.startsWith('/verify') ||
    pathname.startsWith('/unsubscribe')
  );
}

function normalizeHostname(value?: string | null) {
  if (!value) return '';
  const candidate = value.trim().toLowerCase().replace(/\.$/, '');
  if (!candidate || candidate.length > 253 || /[^a-z0-9.:[\]-]/.test(candidate)) return '';
  try {
    return new URL(`http://${candidate}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
}

function parseHostname(value?: string | null) {
  if (!value) return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      return normalizeHostname(new URL(trimmed).host);
    } catch {
      return '';
    }
  }
  return normalizeHostname(trimmed);
}

function buildSubdomainHost(subdomain: string, appHost: string) {
  const cleanSubdomain = parseHostname(subdomain);
  if (!cleanSubdomain) return '';
  if (cleanSubdomain.includes('.')) return cleanSubdomain;
  const baseHost = normalizeHostname(appHost);
  if (!baseHost) return '';
  return `${cleanSubdomain}.${baseHost}`;
}

const INTERNAL_API_BASE =
  process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';

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

async function fetchStatusDomainConfig(): Promise<StatusDomainConfig | null> {
  const now = Date.now();
  if (cachedStatusDomain && cachedStatusDomain.expiresAt > now) return cachedStatusDomain.value;
  if (inflightStatusDomainFetch) return inflightStatusDomainFetch;

  inflightStatusDomainFetch = (async () => {
    try {
      const response = await fetch(`${INTERNAL_API_BASE}/api/status-page/domains`, {
        cache: 'no-store',
        headers: await statusDomainRequestHeaders(),
        signal: AbortSignal.timeout(2000),
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

export function externalRouteKey(hostname: string): string {
  const appHostname = parseHostname(INTERNAL_API_BASE);
  if (appHostname && hostname.endsWith(`.${appHostname}`)) {
    const subdomain = hostname.slice(0, -(appHostname.length + 1));
    if (isSafeStatusSlug(subdomain)) return `subdomain:${subdomain}`;
  }
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
      const value =
        response.status === 404 ? null : parsePublishedStatusRoute(await response.json());
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

  const skipDomainCheck =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/setup') ||
    pathname.startsWith('/logs') ||
    isPublicPath(pathname) ||
    /\.(jpg|jpeg|png|webp|avif|gif|svg|ico|css|js|woff|woff2|ttf|eot|webmanifest)$/i.test(pathname);

  if (!skipDomainCheck) {
    const forwardedHost = req.headers
      .get('x-forwarded-host')
      ?.split(',')
      .map(value => value.trim())
      .filter(Boolean)
      .at(-1);
    const hostname = normalizeHostname(forwardedHost || req.headers.get('host'));
    const publishedPage = hostname ? await fetchPublishedStatusDomain(hostname) : null;
    const statusConfig =
      publishedPage || usesExternalStatusServingStore() ? null : await fetchStatusDomainConfig();
    if (statusConfig?.enabled) {
      const matchedPage = statusConfig.pages?.find(page => {
        const subdomainHost =
          page.subdomain && statusConfig.appHost
            ? buildSubdomainHost(page.subdomain, statusConfig.appHost)
            : '';
        const customHost = parseHostname(page.customDomain);
        return hostname === subdomainHost || hostname === customHost;
      });
      if (hostname && matchedPage && isStatusDomainPath(pathname)) {
        const url = req.nextUrl.clone();
        const pageRoot = matchedPage.slug ? `/status/${matchedPage.slug}` : '/status';
        url.pathname = pathname === '/' || pathname === '' ? pageRoot : `${pageRoot}${pathname}`;
        const rewriteResponse = NextResponse.rewrite(url);
        Object.entries(securityHeaders).forEach(([key, value]) =>
          rewriteResponse.headers.set(key, value)
        );
        rewriteResponse.headers.set('x-request-id', requestId);
        rewriteResponse.headers.set(
          'Cache-Control',
          matchedPage.requireAuth ? PRIVATE_STATUS_CACHE_CONTROL : PUBLIC_STATUS_CACHE_CONTROL
        );
        if (matchedPage.requireAuth) rewriteResponse.headers.set('Vary', 'Cookie');
        return rewriteResponse;
      }
    }
    if (hostname && publishedPage && isStatusDomainPath(pathname)) {
      const url = req.nextUrl.clone();
      const pageRoot = publishedPage.slug ? `/status/${publishedPage.slug}` : '/status';
      url.pathname = pathname === '/' || pathname === '' ? pageRoot : `${pageRoot}${pathname}`;
      const rewriteResponse = NextResponse.rewrite(url);
      Object.entries(securityHeaders).forEach(([key, value]) =>
        rewriteResponse.headers.set(key, value)
      );
      rewriteResponse.headers.set('x-request-id', requestId);
      rewriteResponse.headers.set(
        'Cache-Control',
        publishedPage.requireAuth ? PRIVATE_STATUS_CACHE_CONTROL : PUBLIC_STATUS_CACHE_CONTROL
      );
      if (publishedPage.requireAuth) rewriteResponse.headers.set('Vary', 'Cookie');
      return rewriteResponse;
    }
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
  const shouldRedirectToMobile =
    isMobile &&
    !preferDesktop &&
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

  if (shouldRedirectToMobile) {
    const mobileUrl = req.nextUrl.clone();
    if (pathname === '/') mobileUrl.pathname = '/m';
    else if (pathname === '/login') mobileUrl.pathname = '/m/login';
    else if (pathname === '/forgot-password') mobileUrl.pathname = '/m/forgot-password';
    else mobileUrl.pathname = `/m${pathname}`;
    const redirectResponse = NextResponse.redirect(mobileUrl);
    Object.entries(securityHeaders).forEach(([key, value]) =>
      redirectResponse.headers.set(key, value)
    );
    return redirectResponse;
  }

  if (
    isMobile &&
    !preferDesktop &&
    !pathname.startsWith('/m') &&
    !pathname.startsWith('/api') &&
    !pathname.startsWith('/login') &&
    !pathname.startsWith('/_next') &&
    !isPublicPath(pathname)
  ) {
    const mobileUrl = req.nextUrl.clone();
    mobileUrl.pathname = pathname === '/' ? '/m' : `/m${pathname}`;
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
    Date.now() >= ((token as { sessionExpiresAt: number }).sessionExpiresAt * 1000);
  const isAuthenticated = !!token && !token.error && !!token.sub && !isSessionExpired;

  if (isAuthenticated) {
    const isLoginPage =
      pathname === '/login' ||
      pathname.startsWith('/login/') ||
      pathname === '/m/login' ||
      pathname.startsWith('/m/login/');
    if (isLoginPage) {
      if (req.nextUrl.searchParams.has('error')) return response;
      const defaultDest = isMobile && !preferDesktop ? '/m' : '/';
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
  url.pathname = isMobile && !preferDesktop ? '/m/login' : '/login';
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
