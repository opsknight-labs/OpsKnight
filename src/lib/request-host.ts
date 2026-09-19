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

/**
 * Resolve the authoritative origin (protocol + hostname + optional non-standard port)
 * for seeding SystemSettings.appUrl or forming canonical redirect targets.
 *
 * Distinguishes:
 *   - hostname: used for security comparison (lowercased, bare, no port)
 *   - origin: used for public application URLs (scheme://hostname[:port])
 */
export function getAuthoritativeRequestOrigin(
  source: Request | Headers
): string | null {
  const getHeader = (name: string): string | null => {
    if ('headers' in source && typeof source.headers?.get === 'function') {
      return source.headers.get(name);
    }
    if (typeof (source as Headers).get === 'function') {
      return (source as Headers).get(name);
    }
    return null;
  };

  let hostCandidate: string | null = null;
  if (process.env.TRUST_PROXY_HEADERS === 'true') {
    const forwarded = getHeader('x-forwarded-host');
    if (forwarded) {
      hostCandidate = forwarded
        .split(',')
        .map(v => v.trim())
        .filter(Boolean)
        .at(-1) ?? null;
    }
  }
  if (!hostCandidate) {
    hostCandidate = getHeader('host');
  }
  if (!hostCandidate && 'url' in source && typeof source.url === 'string') {
    try {
      hostCandidate = new URL(source.url).host;
    } catch {
      hostCandidate = null;
    }
  }
  if (!hostCandidate) return null;

  const hostname = normalizeHostname(hostCandidate);
  if (!hostname) return null;

  // Extract port if explicitly present in the host string
  let port: string | null = null;
  const colonIndex = hostCandidate.lastIndexOf(':');
  if (colonIndex !== -1 && !hostCandidate.endsWith(']')) {
    const portPart = hostCandidate.slice(colonIndex + 1);
    if (/^\d+$/.test(portPart)) {
      port = portPart;
    }
  }

  // Determine protocol
  let proto = 'https';
  if (process.env.TRUST_PROXY_HEADERS === 'true') {
    const forwardedProto = getHeader('x-forwarded-proto')
      ?.split(',')
      .map(v => v.trim().toLowerCase())
      .filter(Boolean)
      .at(0);
    if (forwardedProto === 'http' || forwardedProto === 'https') {
      proto = forwardedProto;
    }
  } else {
    const untrustedForwardedProto = getHeader('x-forwarded-proto');

    // Check browser origin header (standard for POST / Server Actions)
    const originHeader = getHeader('origin');
    if (originHeader) {
      try {
        const originUrl = new URL(originHeader);
        if (normalizeHostname(originUrl.host) === hostname) {
          proto = originUrl.protocol.replace(':', '');
          if (!port && originUrl.port) {
            port = originUrl.port;
          }
        }
      } catch {
        // Ignore invalid origin
      }
    } else {
      // Check referer header
      const refererHeader = getHeader('referer');
      if (refererHeader) {
        try {
          const refererUrl = new URL(refererHeader);
          if (normalizeHostname(refererUrl.host) === hostname) {
            proto = refererUrl.protocol.replace(':', '');
            if (!port && refererUrl.port) {
              port = refererUrl.port;
            }
          }
        } catch {
          // Ignore invalid referer
        }
      } else if ('url' in source && typeof source.url === 'string') {
        try {
          const parsedUrl = new URL(source.url);
          if (untrustedForwardedProto) {
            // If untrusted X-Forwarded-Proto was present, Next.js server derived parsedUrl.protocol from it.
            // Discard the spoofed proto if it conflicts with the non-standard port or hostname.
            if (port && port !== '443') {
              proto = 'http';
            } else if (
              hostname === 'localhost' ||
              hostname === '127.0.0.1' ||
              hostname.endsWith('.localhost')
            ) {
              proto = 'http';
            } else {
              proto = 'https';
            }
          } else {
            proto = parsedUrl.protocol.replace(':', '');
          }
          if (!port && parsedUrl.port) {
            port = parsedUrl.port;
          }
        } catch {
          // Fall back to https
        }
      }
    }
  }

  // Strip default ports
  if ((proto === 'http' && port === '80') || (proto === 'https' && port === '443')) {
    port = null;
  }

  return `${proto}://${hostname}${port ? `:${port}` : ''}`;
}

