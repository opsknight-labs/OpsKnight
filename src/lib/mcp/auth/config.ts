import { createHmac, hkdfSync } from 'node:crypto';
import prisma from '@/lib/prisma';
import { getEncryptionKey } from '@/lib/encryption';
import { McpBoundaryError, requireMcp } from '../core/errors';

/**
 * MCP needs two values before it can serve a request, and neither is an MCP environment variable:
 *   - the public origin is the App URL from Settings → System (falling back to the application's
 *     existing URL configuration), and
 *   - the key that hashes MCP credentials is derived from the application encryption key with a
 *     domain-separated HKDF, so no separate secret is stored or configured.
 * `MCP_PUBLIC_ORIGIN` remains an optional override for deployments that pin the origin.
 */

export type McpOriginSource = 'override' | 'app-url' | 'app-environment' | 'development';

type Runtime = {
  origin: string | null;
  originSource: McpOriginSource | null;
  originIssue: string | null;
  loadedAt: number;
};

const RUNTIME_TTL_MS = 5_000;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
let runtime: Runtime | null = null;
let loading: Promise<Runtime> | null = null;

const ORIGIN_HELP =
  'Set the App URL in Settings → System to the HTTPS address users open OpsKnight on (an origin without a path).';

/**
 * Validates a candidate origin. Plain HTTP is accepted only on loopback, and in production only
 * when an administrator configured it explicitly; production never falls back silently.
 */
export function validateMcpOrigin(
  value: string,
  options: { production: boolean; explicit: boolean }
): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new McpBoundaryError('MCP_INVALID_ORIGIN', 503);
  }
  requireMcp(
    url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        LOOPBACK_HOSTS.has(url.hostname) &&
        (!options.production || options.explicit)),
    'MCP_HTTPS_REQUIRED',
    503
  );
  requireMcp(
    !url.username &&
      !url.password &&
      (url.pathname === '/' || url.pathname === '') &&
      !url.search &&
      !url.hash,
    'MCP_INVALID_ORIGIN',
    503
  );
  return url.origin;
}

/** Picks and validates the public origin; exported for unit tests of the precedence rules. */
export function resolveMcpOrigin(appUrl: string | null | undefined, env: NodeJS.ProcessEnv) {
  const production = env.NODE_ENV === 'production';
  const candidates: Array<[string | undefined | null, McpOriginSource, boolean]> = [
    [env.MCP_PUBLIC_ORIGIN, 'override', true],
    [appUrl?.trim() || null, 'app-url', true],
    [env.NEXT_PUBLIC_APP_URL || env.NEXTAUTH_URL, 'app-environment', false],
  ];
  const chosen = candidates.find(([value]) => Boolean(value));
  if (!chosen) {
    if (production)
      return {
        origin: null,
        originSource: null,
        originIssue: `The public URL is not configured. ${ORIGIN_HELP}`,
      };
    return {
      origin: 'http://localhost:3000',
      originSource: 'development' as const,
      originIssue: null,
    };
  }
  const [value, source, explicit] = chosen;
  try {
    return {
      origin: validateMcpOrigin(value!, { production, explicit }),
      originSource: source,
      originIssue: null,
    };
  } catch (error) {
    const code = error instanceof McpBoundaryError ? error.code : 'MCP_INVALID_ORIGIN';
    const problem =
      code === 'MCP_HTTPS_REQUIRED'
        ? 'The public URL must use HTTPS (plain HTTP is accepted only on localhost).'
        : 'The public URL must be an origin without a path, query or credentials.';
    return { origin: null, originSource: source, originIssue: `${problem} ${ORIGIN_HELP}` };
  }
}

/** HMAC key for MCP credential hashes, derived from the active application encryption key. */
function credentialHashKey(): Buffer | null {
  const key = getEncryptionKey();
  if (!key) return null;
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(key, 'hex'), 'opsknight:mcp', 'credential-hash:v1', 32)
  );
}

async function readRuntime(env: NodeJS.ProcessEnv): Promise<Runtime> {
  const settings = await prisma.systemSettings.findUnique({
    where: { id: 'default' },
    select: { appUrl: true },
  });
  return { ...resolveMcpOrigin(settings?.appUrl, env), loadedAt: Date.now() };
}

/** Loads (or refreshes) the database-managed configuration; call at every MCP entry point. */
export async function loadMcpRuntime(options: { force?: boolean } = {}): Promise<Runtime> {
  if (!options.force && runtime && Date.now() - runtime.loadedAt < RUNTIME_TTL_MS) return runtime;
  if (!options.force && loading) return loading;
  const pending = readRuntime(process.env).then(loaded => {
    runtime = loaded;
    return loaded;
  });
  const settle = () => {
    if (loading === pending) loading = null;
  };
  pending.then(settle, settle);
  loading = pending;
  return pending;
}

/** Runs an MCP request with its configuration loaded. */
export async function withMcpRuntime<T>(callback: () => Promise<T>): Promise<T> {
  await loadMcpRuntime();
  return callback();
}

export function resetMcpRuntimeForTests() {
  runtime = null;
  loading = null;
}

export function mcpOrigin(): string {
  if (runtime) {
    requireMcp(runtime.origin, 'MCP_ORIGIN_REQUIRED', 503);
    return runtime.origin;
  }
  // Without a loaded runtime only an explicit override is trustworthy.
  if (process.env.MCP_PUBLIC_ORIGIN)
    return validateMcpOrigin(process.env.MCP_PUBLIC_ORIGIN, {
      production: process.env.NODE_ENV === 'production',
      explicit: true,
    });
  throw new McpBoundaryError('MCP_RUNTIME_NOT_LOADED', 503);
}

export function mcpResource() {
  return `${mcpOrigin()}/mcp`;
}
export function mcpIssuer() {
  return `${mcpOrigin()}/oauth/mcp`;
}

export function digestMcpSecret(value: string) {
  const key = credentialHashKey();
  requireMcp(key, 'MCP_HASH_SECRET_UNAVAILABLE', 503);
  return createHmac('sha256', key).update('opsknight:mcp:v1\0').update(value).digest('hex');
}

export type McpConfigurationStatus = {
  origin: string | null;
  originSource: McpOriginSource | null;
  issues: string[];
};

/** Plain-language problems that would make an enabled MCP endpoint fail at request time. */
export async function getMcpConfigurationStatus(
  options: { force?: boolean } = {}
): Promise<McpConfigurationStatus> {
  const loaded = await loadMcpRuntime(options);
  return {
    origin: loaded.origin,
    originSource: loaded.originSource,
    issues: [
      loaded.originIssue,
      credentialHashKey()
        ? null
        : 'The application encryption key is not configured or is invalid; MCP uses it to protect credentials. Check System Health.',
    ].filter((issue): issue is string => !!issue),
  };
}
