/**
 * Centralized same-origin "callback URL" sanitizer.
 *
 * Used by the login pages, the middleware and any client redirect logic so a
 * single definition controls what counts as a safe post-auth redirect target.
 *
 * The critical rule: a target must start with a SINGLE "/" and must NOT start
 * with "//" (protocol-relative external URL, e.g. `//evil.example`). It must
 * also have no scheme, userinfo, or authority component, so values like
 * `https://evil.example`, `/\evil.example` and `//evil.example` are all
 * rejected. Paths are allowed to be deep (e.g. `/incidents/abc`) but must not
 * escape to an auth page or signout.
 */

const BLOCKED_PATH_PREFIXES = [
  '/login',
  '/m/login',
  '/forgot-password',
  '/m/forgot-password',
  '/reset-password',
  '/m/reset-password',
  '/api/auth',
];

const BLOCKED_PATH_SEGMENTS = ['signout'];

/**
 * Returns true when `candidate` is a safe same-origin redirect target.
 *
 * - Must be a non-empty string starting with "/".
 * - Must not start with "//" (protocol-relative) or "/\" (backslash scheme trick).
 * - Must not contain a scheme or authority.
 * - Must not point at auth pages or signout endpoints.
 */
export function isSafeCallbackUrl(candidate: string | null | undefined): candidate is string {
  if (typeof candidate !== 'string' || candidate.length === 0) return false;
  if (!candidate.startsWith('/')) return false;
  // Protocol-relative URL: //evil.example
  if (candidate.startsWith('//')) return false;
  // Backslash can be treated as a path separator/scheme trick by some clients
  if (candidate.startsWith('/\\')) return false;
  // Any embedded scheme or authority (e.g. "/\evil.example" handled above,
  // "https:/evil.example" or "//evil" caught by the // and scheme checks).
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(candidate)) return false;

  if (
    BLOCKED_PATH_PREFIXES.some(prefix => candidate === prefix || candidate.startsWith(`${prefix}/`))
  ) {
    return false;
  }
  const segments = candidate
    .split('/')
    .filter(Boolean)
    .map(s => s.toLowerCase());
  if (segments.some(seg => BLOCKED_PATH_SEGMENTS.some(blocked => seg.includes(blocked)))) {
    return false;
  }
  return true;
}

/**
 * Returns `candidate` when it is a safe same-origin redirect target,
 * otherwise returns `fallback` (default "/").
 */
export function sanitizeCallbackUrl(candidate: string | null | undefined, fallback = '/'): string {
  return isSafeCallbackUrl(candidate) ? candidate : fallback;
}
