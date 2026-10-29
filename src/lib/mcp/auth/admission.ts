import { getClientIp } from '@/lib/client-ip';
import { checkRateLimit } from '@/lib/rate-limit';
import { digestMcpSecret } from './config';
import { requireMcp } from '../core/errors';

const oauthInFlight = new Map<'token' | 'revoke', number>();
/** Slow token uploads cannot consume MCP authentication or revocation admission. */
export function acquireMcpOAuthSlot(endpoint: 'token' | 'revoke') {
  const active = oauthInFlight.get(endpoint) ?? 0;
  requireMcp(active < 2, 'MCP_BUSY', 503);
  oauthInFlight.set(endpoint, active + 1);
  let released = false;
  return () => {
    if (!released) {
      released = true;
      oauthInFlight.set(endpoint, (oauthInFlight.get(endpoint) ?? 1) - 1);
    }
  };
}

/** Untrusted callers cannot spend another known peer's small OAuth quota. */
export async function admitMcpOAuthRequest(
  request: Request,
  endpoint: 'token' | 'revoke' | 'register'
) {
  const ip = getClientIp(request);
  // Next's direct Request does not expose the socket peer. Never trust a spoofable
  // header to invent one; such deployments share only the larger safety ceiling.
  if (ip !== '0.0.0.0') {
    const peer = digestMcpSecret(`oauth-peer:${ip}`);
    requireMcp(
      (
        await checkRateLimit(
          `mcp:oauth:${endpoint}:peer:${peer}`,
          endpoint === 'register' ? 10 : 60,
          60000
        )
      ).allowed,
      'MCP_RATE_LIMITED',
      429
    );
  }
  requireMcp(
    (
      await checkRateLimit(
        `mcp:oauth:${endpoint}:global`,
        endpoint === 'register' ? 60 : 2048,
        60000
      )
    ).allowed,
    'MCP_RATE_LIMITED',
    429
  );
}
