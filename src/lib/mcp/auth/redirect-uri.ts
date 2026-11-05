const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// Private-use schemes (RFC 8252 §7.1) that are never a native-app callback: they run script,
// read local data or open a socket instead of handing the code to an installed application.
const REFUSED_SCHEMES = new Set([
  'javascript:',
  'data:',
  'file:',
  'blob:',
  'vbscript:',
  'about:',
  'ws:',
  'wss:',
  'http:',
  'https:',
]);
// Editors whose registered scheme has no dot, so the reverse-DNS rule alone would refuse them.
const KNOWN_APP_SCHEMES = new Set(['cursor:', 'vscode:', 'vscode-insiders:', 'windsurf:']);

/** An app-scheme callback such as cursor://anysphere.cursor-mcp/oauth/callback. */
function privateUseRedirect(url: URL) {
  return (
    /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) &&
    !REFUSED_SCHEMES.has(url.protocol) &&
    (url.protocol.includes('.') || KNOWN_APP_SCHEMES.has(url.protocol)) &&
    Boolean(url.host || url.pathname)
  );
}

/**
 * Whether a redirect URI may be registered (DCR, CIMD or an administrator): a canonical URL with
 * no user name, password or fragment that is HTTPS, http on a loopback host, or a native app's
 * private-use scheme (reverse-DNS, or a known editor's). Requests still match it exactly; only
 * http loopback redirects get port flexibility (redirectUriAllowed). A client metadata document is
 * fetched from its publisher rather than stored from a form, so `canonicalWeb: false` keeps its
 * web redirects accepted as written.
 */
export function isAllowedRedirect(value: string, { canonicalWeb = true } = {}) {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)))
      // Canonical form, allowing the empty path that native clients often register
      // (http://127.0.0.1:33418 is stored and matched exactly as sent).
      return !canonicalWeb || url.href === value || url.href === `${value}/`;
    return url.href === value && privateUseRedirect(url);
  } catch {
    return false;
  }
}

function loopback(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname) ? url : null;
  } catch {
    return null;
  }
}

/**
 * Exact match, except that a registered loopback redirect (http://localhost/…, 127.0.0.1, [::1])
 * matches the same host and path on any port. Native clients such as Claude Code bind a fresh
 * port per sign-in while keeping their registration (RFC 8252 §7.3).
 */
export function redirectUriAllowed(registered: readonly string[], requested: string) {
  if (registered.includes(requested)) return true;
  const asked = loopback(requested);
  if (!asked) return false;
  return registered.some(uri => {
    const known = loopback(uri);
    return (
      known !== null &&
      known.hostname === asked.hostname &&
      known.pathname === asked.pathname &&
      known.search === asked.search &&
      !asked.username &&
      !asked.password &&
      !asked.hash
    );
  });
}

/**
 * A URL safe to write to logs: scheme, host, port and path only. Query strings and fragments can
 * carry credentials, so they are dropped and only marked as present. Non-URL values (registered
 * client ids) are returned bounded.
 */
export function urlForLog(value: string) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search || url.hash ? '?…' : ''}`.slice(0, 512);
  } catch {
    return value.slice(0, 256);
  }
}
