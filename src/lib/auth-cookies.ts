/**
 * Centralized NextAuth cookie configuration.
 *
 * NextAuth's built-in auto-detection of `useSecureCookies` reads the request
 * protocol, which is unreliable behind reverse proxies (Cloudflare Tunnel
 * terminates TLS and forwards HTTP). We derive the protocol from NEXTAUTH_URL
 * — an explicit, environment-controlled value — so prod (HTTPS) and test/dev
 * (HTTP) each get the correct cookie shape:
 *
 *   - HTTPS: `__Secure-` / `__Host-` prefixed names, Secure flag set
 *   - HTTP:  unprefixed names, Secure flag cleared (browsers reject Secure
 *            cookies over HTTP, which would otherwise cause a login loop)
 *
 * Both `getAuthOptions()` and the edge middleware must agree on the cookie
 * name, so they both import from this module.
 */

export const useSecureCookies =
  (process.env.NEXTAUTH_URL ?? '').startsWith('https://') ||
  (process.env.NODE_ENV === 'production' &&
    !(process.env.NEXTAUTH_URL ?? '').startsWith('http://'));

const cookiePrefix = useSecureCookies ? '__Secure-' : '';
const hostCookiePrefix = useSecureCookies ? '__Host-' : '';

export const SESSION_TOKEN_COOKIE_NAME = `${cookiePrefix}next-auth.session-token`;
export const CALLBACK_URL_COOKIE_NAME = `${cookiePrefix}next-auth.callback-url`;
export const CSRF_TOKEN_COOKIE_NAME = `${hostCookiePrefix}next-auth.csrf-token`;
export const PKCE_CODE_VERIFIER_COOKIE_NAME = `${cookiePrefix}next-auth.pkce.code_verifier`;
export const STATE_COOKIE_NAME = `${cookiePrefix}next-auth.state`;
export const NONCE_COOKIE_NAME = `${cookiePrefix}next-auth.nonce`;
