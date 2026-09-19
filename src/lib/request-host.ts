/**
 * Shared request host resolution.
 *
 * Both the middleware (edge) and server-side bootstrap code must resolve
 * the authoritative request host using the exact same interpretation of:
 *   - Host header
 *   - X-Forwarded-Host header
 *   - TRUST_PROXY_HEADERS env var
 *
 * This module provides that shared logic so the middleware and bootstrap
 * can never disagree on what the request's hostname is.
 */

/**
 * Normalize a bare hostname (not a URL) to lowercase, stripped of trailing dots,
 * port, and syntactically invalid values.
 */
export function normalizeHostname(value?: string | null): string {
  if (!value) return '';
  const candidate = value.trim().toLowerCase().replace(/\.$/, '');
  if (!candidate || candidate.length > 253 || /[^a-z0-9.:[\]-]/.test(candidate)) return '';
  try {
    return new URL(`http://${candidate}`).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return '';
  }
}

/**
 * Parse a hostname from a value that may be a bare hostname, a host:port,
 * or a full URL (http:// or https://).
 */
export function parseHostname(value?: string | null): string {
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

/**
 * Resolve the authoritative hostname for a request, respecting the
 * `TRUST_PROXY_HEADERS` environment variable.
 *
 * When `TRUST_PROXY_HEADERS=true`, the last entry of the `X-Forwarded-Host`
 * header is used (the value the ingress/reverse-proxy is expected to
 * **overwrite**, not append).
 *
 * When proxy headers are not trusted (the default), only the raw `Host`
 * header is used — a client-supplied `X-Forwarded-Host` cannot influence
 * routing.
 */
export function getAuthoritativeRequestHost(req: Request): string {
  if (process.env.TRUST_PROXY_HEADERS === 'true') {
    const forwarded = req.headers.get('x-forwarded-host');
    if (forwarded) {
      const rawForwarded = forwarded
        .split(',')
        .map(value => value.trim())
        .filter(Boolean)
        .at(-1);
      const cleanForwarded = normalizeHostname(rawForwarded);
      if (cleanForwarded) return cleanForwarded;
    }
  }
  const rawHost = normalizeHostname(req.headers.get('host'));
  if (rawHost) return rawHost;
  try {
    const url = new URL(req.url);
    return normalizeHostname(url.host);
  } catch {
    return '';
  }
}
