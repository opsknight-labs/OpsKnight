const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

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
