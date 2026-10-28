import { createHmac } from 'node:crypto';
import { requireMcp } from '../core/errors';

// Infrastructure bootstrap only; rollout and workload policy live in PostgreSQL.
export function mcpOrigin(env: NodeJS.ProcessEnv = process.env) {
  const configuredOrigin = env.MCP_PUBLIC_ORIGIN ?? env.NEXTAUTH_URL;
  requireMcp(
    env.NODE_ENV !== 'production' || Boolean(configuredOrigin),
    'MCP_ORIGIN_REQUIRED',
    503
  );
  const url = new URL(configuredOrigin ?? 'http://localhost:3000');
  // A production build may serve plain HTTP only on an explicitly configured loopback origin
  // and only with an explicit opt-in (local certification); traffic never leaves the host.
  const loopbackHttpAllowed =
    env.NODE_ENV !== 'production' ||
    (Boolean(configuredOrigin) && env.MCP_ALLOW_LOOPBACK_HTTP_ORIGIN === 'true');
  requireMcp(
    url.protocol === 'https:' ||
      (loopbackHttpAllowed &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)),
    'MCP_HTTPS_REQUIRED',
    503
  );
  requireMcp(
    !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash,
    'MCP_INVALID_ORIGIN',
    503
  );
  return url.origin;
}

export function mcpResource() {
  return `${mcpOrigin()}/mcp`;
}
export function mcpIssuer() {
  return `${mcpOrigin()}/oauth/mcp`;
}

export function digestMcpSecret(value: string) {
  const key = process.env.MCP_TOKEN_HASH_SECRET;
  requireMcp(key && Buffer.byteLength(key) >= 32, 'MCP_HASH_SECRET_REQUIRED', 503);
  return createHmac('sha256', key).update('opsknight:mcp:v1\0').update(value).digest('hex');
}

/** Plain-language problems that would make an enabled MCP endpoint fail at request time. */
export function mcpConfigurationIssues(env: NodeJS.ProcessEnv = process.env) {
  const issues: string[] = [];
  const key = env.MCP_TOKEN_HASH_SECRET;
  if (!key || Buffer.byteLength(key) < 32)
    issues.push('MCP_TOKEN_HASH_SECRET must be a random secret of at least 32 bytes.');
  const configuredOrigin = env.MCP_PUBLIC_ORIGIN ?? env.NEXTAUTH_URL;
  if (!configuredOrigin && env.NODE_ENV === 'production') {
    issues.push(
      'MCP_PUBLIC_ORIGIN or NEXTAUTH_URL must be explicitly configured in production; localhost fallback is development-only.'
    );
  } else {
    try {
      mcpOrigin(env);
    } catch {
      issues.push(
        'MCP_PUBLIC_ORIGIN (or NEXTAUTH_URL) must be an HTTPS origin without a path; HTTP is allowed only on loopback in development.'
      );
    }
  }
  return issues;
}
