import { NextResponse, type NextRequest } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { logger } from '@/lib/logger';
import { getNextAuthSecret } from '@/lib/secret-manager';
import { SESSION_TOKEN_COOKIE_NAME, useSecureCookies } from '@/lib/auth-cookies';

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

/**
 * Detect mobile device from User-Agent header
 */
function isMobileUserAgent(userAgent: string | null): boolean {
  if (!userAgent) {
    logger.info('Mobile detection: No user agent');
    return false;
  }
  // Match common mobile device patterns
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

function isPublicPath(pathname: string) {
  // Exact matches for public paths
  if (PUBLIC_PATH_PREFIXES.some(path => pathname === path || pathname.startsWith(`${path}/`))) {
    return true;
  }

  // Next.js and static files
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

  // Public static assets in /public folder (images, etc)
  // Only allow specific extensions to avoid leaking pages as static files
  return /\.(jpg|jpeg|png|gif|svg|ico|css|js|woff|woff2|ttf|eot|webmanifest)$/i.test(pathname);
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
  return value.split(':')[0]?.trim().toLowerCase() || '';
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
  if (cleanSubdomain.includes('.')) {
    return cleanSubdomain;
  }
  const baseHost = normalizeHostname(appHost);
  if (!baseHost) return '';
  return `${cleanSubdomain}.${baseHost}`;
}

const INTERNAL_API_BASE =
  process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';

type StatusDomainConfig = {
  enabled: boolean;
  subdomain?: string | null;
  customDomain?: string | null;
  appHost?: string | null;
};

// In-process cache so we don't fire an HTTP+DB call on every page
// navigation. The DB-backed config changes only when an admin edits
// status-page settings; STATUS_PAGE_DOMAIN_CACHE_TTL (default 60s) is
// the worst-case staleness for a custom-domain change to take effect.
// Edge runtime: each isolate has its own cache — that's fine since
// 60s is short enough to keep them within a reasonable drift window.
type CachedDomainConfig = {
  value: StatusDomainConfig | null;
  expiresAt: number;
};
let cachedStatusDomain: CachedDomainConfig | null = null;
let inflightStatusDomainFetch: Promise<StatusDomainConfig | null> | null = null;

async function fetchStatusDomainConfig(): Promise<StatusDomainConfig | null> {
  const now = Date.now();
  if (cachedStatusDomain && cachedStatusDomain.expiresAt > now) {
    return cachedStatusDomain.value;
  }

  // Coalesce concurrent navigations behind a single in-flight fetch
  // (a typical post-login burst can land 3-4 navigations in <100ms).
  if (inflightStatusDomainFetch) {
    return inflightStatusDomainFetch;
  }

  inflightStatusDomainFetch = (async () => {
    try {
      const response = await fetch(`${INTERNAL_API_BASE}/api/status-page/domains`, {
        cache: 'no-store',
        headers: { 'x-internal-request': 'status-domain-check' },
      });
      const value = response.ok ? ((await response.json()) as StatusDomainConfig) : null;
      cachedStatusDomain = {
        value,
        expiresAt: Date.now() + STATUS_DOMAIN_CACHE_TTL * 1000,
      };
      return value;
    } catch {
      // Negative-cache failures for a short window too, so a flapping
      // backend doesn't get hammered by every page hit.
      cachedStatusDomain = {
        value: null,
        expiresAt: Date.now() + Math.min(STATUS_DOMAIN_CACHE_TTL, 10) * 1000,
      };
      return null;
    } finally {
      inflightStatusDomainFetch = null;
    }
  })();

  return inflightStatusDomainFetch;
}

/**
 * Security headers to apply to all responses
 */
function getSecurityHeaders(): Record<string, string> {
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    // Prevent MIME type sniffing
    'X-Content-Type-Options': 'nosniff',
    // Prevent clickjacking
    'X-Frame-Options': 'DENY',
    // XSS protection (legacy but still useful)
    'X-XSS-Protection': '1; mode=block',
    // Referrer policy
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Permissions policy (formerly Feature-Policy)
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    // Content Security Policy
    // Note: 'unsafe-eval' is required by Next.js for development hot reloading
    // Note: 'unsafe-inline' is required for styled-jsx and inline styles
    // For stricter CSP, consider using nonce-based approach with next-safe package
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
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
    // HSTS (only in production with HTTPS)
    ...(isProduction && {
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    }),
  };
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

  // Create response with security headers
  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  response.headers.set('x-request-id', requestId);
  const securityHeaders = getSecurityHeaders();
  Object.entries(securityHeaders).forEach(([key, value]) => {
    response.headers.set(key, value);
  });

  // Telemetry removed - using standard logging instead

  // ===== DOMAIN CONFIG (STATUS PAGE) =====
  // Skip domain check for internal paths, static files, and most API routes to save performance
  const skipDomainCheck =
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.startsWith('/setup') ||
    pathname.startsWith('/status') ||
    pathname.startsWith('/logs') ||
    isPublicPath(pathname) ||
    /\.(jpg|jpeg|png|gif|svg|ico|css|js|woff|woff2|ttf|eot|webmanifest)$/i.test(pathname);

  if (!skipDomainCheck) {
    const statusConfig = await fetchStatusDomainConfig();
    if (statusConfig?.enabled) {
      const forwardedHost = req.headers
        .get('x-forwarded-host')
        ?.split(',')
        .map(value => value.trim())
        .filter(Boolean)
        .at(-1);
      const hostname = normalizeHostname(forwardedHost || req.headers.get('host'));
      const allowedHosts = new Set<string>();
      if (statusConfig.subdomain && statusConfig.appHost) {
        const subdomainHost = buildSubdomainHost(statusConfig.subdomain, statusConfig.appHost);
        if (subdomainHost) {
          allowedHosts.add(subdomainHost);
        }
      }
      if (statusConfig.customDomain) {
        const customHost = parseHostname(statusConfig.customDomain);
        if (customHost) {
          allowedHosts.add(customHost);
        }
      }
      if (hostname && allowedHosts.has(hostname) && isStatusDomainPath(pathname)) {
        const url = req.nextUrl.clone();
        url.pathname = pathname === '/' || pathname === '' ? '/status' : `/status${pathname}`;
        const rewriteResponse = NextResponse.rewrite(url);
        Object.entries(securityHeaders).forEach(([key, value]) => {
          rewriteResponse.headers.set(key, value);
        });
        rewriteResponse.headers.set('x-request-id', requestId);
        return rewriteResponse;
      }
    }
  }

  // ===== MOBILE DEVICE REDIRECT =====
  const userAgent = req.headers.get('user-agent');
  const isMobile = isMobileUserAgent(userAgent);
  const preferDesktop = req.cookies.get('prefer-desktop')?.value === 'true';

  // Redirect mobile users to mobile routes, unless:
  // - Already on mobile route (/m/*)
  // - User prefers desktop (cookie set)
  // - Accessing API, static files, or setup pages
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
    !/\.(jpg|jpeg|png|gif|svg|ico|css|js|woff|woff2|ttf|eot|webmanifest)$/i.test(pathname);

  if (shouldRedirectToMobile) {
    const mobileUrl = req.nextUrl.clone();
    // Map desktop routes to mobile equivalents
    if (pathname === '/') {
      mobileUrl.pathname = '/m';
    } else if (pathname === '/login') {
      // Special redirect for login page
      mobileUrl.pathname = '/m/login';
    } else if (pathname === '/forgot-password') {
      // Special redirect for forgot password page
      mobileUrl.pathname = '/m/forgot-password';
    } else if (pathname === '/reset-password') {
      // Special redirect for reset password page
      mobileUrl.pathname = '/m/reset-password';
    } else {
      mobileUrl.pathname = `/m${pathname}`;
    }
    const redirectResponse = NextResponse.redirect(mobileUrl);
    Object.entries(securityHeaders).forEach(([key, value]) => {
      redirectResponse.headers.set(key, value);
    });
    return redirectResponse;
  }

  // STRICT CHECK: If on mobile, prohibit access to desktop pages if not explicitly opted in
  // This covers case where user manually types /incidents
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
    mobileUrl.pathname = '/m'; // Send to mobile home or attempt mapping
    // Attempt mapping
    if (pathname !== '/') mobileUrl.pathname = `/m${pathname}`;

    const redirectResponse = NextResponse.redirect(mobileUrl);
    Object.entries(securityHeaders).forEach(([key, value]) => {
      redirectResponse.headers.set(key, value);
    });
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

      if (req.method === 'OPTIONS') {
        return new NextResponse(null, { status: 204, headers: corsHeaders });
      }

      // NOTE: Rate limiting is now handled in the individual API routes (Node.js runtime)
      // to support Distributed Rate Limiting via PostgreSQL, which cannot run in Edge Middleware.

      const apiResponse = NextResponse.next({ request: { headers: forwardedHeaders } });
      apiResponse.headers.set('x-request-id', requestId);
      // Apply CORS headers
      Object.entries(corsHeaders).forEach(([key, value]) => {
        apiResponse.headers.set(key, value);
      });
      // Apply security headers
      Object.entries(securityHeaders).forEach(([key, value]) => {
        apiResponse.headers.set(key, value);
      });
      return apiResponse;
    }

    // NOTE: Rate limiting is now handled in the individual API routes (Node.js runtime)
    // to support Distributed Rate Limiting via PostgreSQL, which cannot run in Edge Middleware.

    // Let API routes handle auth/authorization; avoid login redirects for API calls.
    return response;
  }

  // Private status pages must never be cached by browsers or shared CDNs. These
  // headers are safe for public pages too and prevent configuration changes from
  // leaving stale status data at an intermediary.
  if (pathname === '/status' || pathname.startsWith('/status/')) {
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Vary', 'Cookie');
  }

  // Check authentication status
  const token = await getToken({
    req,
    secret: await getNextAuthSecret(),
    cookieName: SESSION_TOKEN_COOKIE_NAME,
    secureCookie: useSecureCookies,
  });
  // Check if token exists AND is valid (not revoked/errored)
  const isAuthenticated = !!token && !token.error && !!token.sub;

  // Handle authenticated users trying to access public auth pages
  if (isAuthenticated) {
    // Redirect authenticated users away from auth-related pages (/login, /m/login)
    const isLoginPage =
      pathname === '/login' ||
      pathname.startsWith('/login/') ||
      pathname === '/m/login' ||
      pathname.startsWith('/m/login/');

    if (isLoginPage) {
      // Allow access if explicitly handling an error parameter (prevents redirect loops on session failure/revocation)
      if (req.nextUrl.searchParams.has('error')) {
        return response;
      }

      // Redirect authenticated users away from login page to target or home
      const callbackUrl = req.nextUrl.searchParams.get('callbackUrl');
      const defaultDest = isMobile && !preferDesktop ? '/m' : '/';
      const isValidTarget =
        callbackUrl &&
        callbackUrl.startsWith('/') &&
        !callbackUrl.startsWith('/login') &&
        !callbackUrl.startsWith('/m/login') &&
        !callbackUrl.includes('/signout') &&
        !callbackUrl.includes('/auth/signout');

      const redirectUrl = isValidTarget ? callbackUrl : defaultDest;
      const redirectResponse = NextResponse.redirect(new URL(redirectUrl, req.url));
      // Apply security headers to redirect
      Object.entries(securityHeaders).forEach(([key, value]) => {
        redirectResponse.headers.set(key, value);
      });
      return redirectResponse;
    }
    // Authenticated user accessing protected route - allow
    return response;
  }

  // Handle unauthenticated users
  if (isPublicPath(pathname)) {
    // Allow access to public paths
    return response;
  }

  // Unauthenticated user trying to access protected route - redirect to login
  const url = req.nextUrl.clone();
  // Redirect mobile users to mobile login page
  url.pathname = isMobile && !preferDesktop ? '/m/login' : '/login';
  url.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
  const redirectResponse = NextResponse.redirect(url);
  // Ensure redirects are never cached by browser or service worker
  redirectResponse.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  redirectResponse.headers.set('Pragma', 'no-cache');
  // Apply security headers to redirect
  Object.entries(securityHeaders).forEach(([key, value]) => {
    redirectResponse.headers.set(key, value);
  });
  return redirectResponse;
}

export const config = {
  // Match all request paths except for the ones starting with:
  // - _next/static (static files)
  // - _next/image (image optimization files)
  // - favicon.ico (favicon file)
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
