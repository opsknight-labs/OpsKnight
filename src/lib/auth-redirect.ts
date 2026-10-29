const INTERNAL_ORIGIN = 'https://opsknight.invalid';
const MAX_CALLBACK_LENGTH = 2048;
// Assistants send long redirect URIs and state values; the OAuth authorize URL is rebuilt exactly
// after sign-in, so it needs more room than ordinary application links.
const MAX_MCP_AUTHORIZE_CALLBACK_LENGTH = 6144;
const MCP_AUTHORIZE_PREFIX = '/oauth/mcp/authorize?';
const FORBIDDEN_AUTH_PREFIXES = [
  '/login',
  '/m/login',
  '/forgot-password',
  '/m/forgot-password',
  '/reset-password',
  '/m/reset-password',
  '/set-password',
  '/setup',
  '/auth/signout',
  '/api/auth/signout',
];

function decodePathSafely(pathname: string): string {
  let current = pathname;
  for (let i = 0; i < 2; i += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      return '';
    }
  }
  return current;
}

/**
 * Accept only same-origin application-relative callback URLs.
 *
 * Rejects protocol-relative URLs, backslash normalization tricks, control
 * characters and authentication-loop destinations. This helper is deliberately
 * runtime-agnostic so middleware and client auth pages use the exact same policy.
 */
export function safeInternalCallbackUrl(value: string | null | undefined, fallback = '/'): string {
  if (!value) return fallback;
  if (/[\\\u0000-\u001F\u007F]/.test(value)) return fallback;
  const candidate = value.trim();
  if (
    candidate.length === 0 ||
    candidate.length >
      (candidate.startsWith(MCP_AUTHORIZE_PREFIX)
        ? MAX_MCP_AUTHORIZE_CALLBACK_LENGTH
        : MAX_CALLBACK_LENGTH) ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.startsWith('/\\')
  ) {
    return fallback;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate, INTERNAL_ORIGIN);
  } catch {
    return fallback;
  }
  if (parsed.origin !== INTERNAL_ORIGIN) return fallback;

  const decodedPath = decodePathSafely(parsed.pathname);
  if (!decodedPath || decodedPath.startsWith('//') || decodedPath.includes('\\')) {
    return fallback;
  }

  const lowerPath = decodedPath.toLowerCase();
  if (
    FORBIDDEN_AUTH_PREFIXES.some(
      prefix => lowerPath === prefix || lowerPath.startsWith(`${prefix}/`)
    )
  ) {
    return fallback;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
