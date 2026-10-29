import { getClientIp } from '@/lib/client-ip';
import { checkRateLimit } from '@/lib/rate-limit';
import { digestMcpSecret } from './config';
import { requireMcp } from '../core/errors';

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
