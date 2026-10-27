import { createHmac } from 'node:crypto';
import { requireMcp } from '../core/errors';

// Infrastructure bootstrap only; rollout and workload policy live in PostgreSQL.
export function mcpOrigin() {
  const url = new URL(
    process.env.MCP_PUBLIC_ORIGIN ?? process.env.NEXTAUTH_URL ?? 'http://localhost:3000'
  );
  requireMcp(
    url.protocol === 'https:' ||
      (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)),
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
