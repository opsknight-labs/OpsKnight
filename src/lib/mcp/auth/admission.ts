import { getClientIp } from '@/lib/client-ip';
import { checkRateLimit } from '@/lib/rate-limit';
import { digestMcpSecret } from './config';
import { requireMcp } from '../core/errors';

/** Token and revocation work held at once per process; a small share of the database pool. */
export const MCP_OAUTH_SLOTS = 8;
const MCP_OAUTH_WAIT_MS = 250;
const oauthInFlight = new Map<'token' | 'revoke', number>();
const oauthWaiters = new Map<'token' | 'revoke', (() => void)[]>();

/**
 * Slow token uploads cannot consume MCP authentication or revocation admission. A burst waits
 * briefly for a free slot; a refusal is a retryable temporarily_unavailable, never a sign-out.
 */
export async function acquireMcpOAuthSlot(
  endpoint: 'token' | 'revoke',
  waitMs = MCP_OAUTH_WAIT_MS
): Promise<() => void> {
  const deadline = Date.now() + waitMs;
  while ((oauthInFlight.get(endpoint) ?? 0) >= MCP_OAUTH_SLOTS) {
    const remaining = deadline - Date.now();
    requireMcp(remaining > 0, 'temporarily_unavailable', 503);
    await new Promise<void>(resolve => {
      const waiters = oauthWaiters.get(endpoint) ?? [];
      oauthWaiters.set(endpoint, waiters);
      const wake = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const index = waiters.indexOf(wake);
        if (index >= 0) waiters.splice(index, 1);
        resolve();
      }, remaining);
      waiters.push(wake);
    });
  }
  oauthInFlight.set(endpoint, (oauthInFlight.get(endpoint) ?? 0) + 1);
  let released = false;
  return () => {
    if (!released) {
      released = true;
      oauthInFlight.set(endpoint, (oauthInFlight.get(endpoint) ?? 1) - 1);
      oauthWaiters.get(endpoint)?.shift()?.();
    }
  };
}

/** Bad bearer tokens allowed per peer per minute on /mcp before refusing without a lookup. */
export const MCP_BAD_TOKEN_LIMIT = 30;
const BAD_TOKEN_PEERS_MAX = 10000;
let badTokenWindow = 0;
const badTokenPeers = new Map<string, number>();
const badTokenPeer = (request: Request) => {
  const ip = getClientIp(request);
  // An unknown peer is never limited here (fail open): the per-grant quota still applies.
  return ip === '0.0.0.0' ? null : ip;
};
const currentBadTokenWindow = () => {
  const window = Math.floor(Date.now() / 60000);
  if (window !== badTokenWindow) {
    badTokenWindow = window;
    badTokenPeers.clear();
  }
};

/** Refuse a peer that keeps presenting invalid credentials, before any database work. */
export function admitMcpBearer(request: Request) {
  const peer = badTokenPeer(request);
  if (!peer) return;
  currentBadTokenWindow();
  requireMcp((badTokenPeers.get(peer) ?? 0) < MCP_BAD_TOKEN_LIMIT, 'MCP_RATE_LIMITED', 429);
}

/** Count one failed bearer authentication against the peer. In memory, per process. */
export function recordMcpBearerFailure(request: Request) {
  const peer = badTokenPeer(request);
  if (!peer) return;
  currentBadTokenWindow();
  if (!badTokenPeers.has(peer) && badTokenPeers.size >= BAD_TOKEN_PEERS_MAX) return;
  badTokenPeers.set(peer, (badTokenPeers.get(peer) ?? 0) + 1);
}

export function resetMcpAdmissionForTests() {
  badTokenPeers.clear();
  oauthInFlight.clear();
  oauthWaiters.clear();
}

/** Untrusted callers cannot spend another known peer's small OAuth quota. */
export async function admitMcpOAuthRequest(
  request: Request,
  endpoint: 'token' | 'revoke' | 'register' | 'device_authorization'
) {
  // Registration and device sign-in create rows from anonymous requests: a much smaller budget.
  const small = endpoint === 'register' || endpoint === 'device_authorization';
  const ip = getClientIp(request);
  // Next's direct Request does not expose the socket peer. Never trust a spoofable
  // header to invent one; such deployments share only the larger safety ceiling.
  if (ip !== '0.0.0.0') {
    const peer = digestMcpSecret(`oauth-peer:${ip}`);
    requireMcp(
      (await checkRateLimit(`mcp:oauth:${endpoint}:peer:${peer}`, small ? 10 : 60, 60000)).allowed,
      'MCP_RATE_LIMITED',
      429
    );
  }
  requireMcp(
    (await checkRateLimit(`mcp:oauth:${endpoint}:global`, small ? 60 : 2048, 60000)).allowed,
    'MCP_RATE_LIMITED',
    429
  );
}
