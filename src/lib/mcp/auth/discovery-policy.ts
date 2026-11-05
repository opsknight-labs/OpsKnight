import prisma from '@/lib/prisma';

/**
 * The policy fields public, unauthenticated MCP documents and headers need: discovery metadata,
 * the 401 challenge's scope hint and browser CORS. Anyone can request those, so they are served
 * from a short in-process memo instead of a database read per request. A flood then costs at
 * most one primary-key read per process per TTL, and the small MCP pool stays free for /mcp and
 * the token endpoint. Policy saves clear it, so the saving process sees the change at once;
 * other processes see it within the TTL.
 */
export interface McpDiscoveryPolicy {
  enabled: boolean;
  dcrEnabled: boolean;
  dcrScopes: string[];
  cimdEnabled: boolean;
  cimdScopes: string[];
  cimdAllowedHosts: string[];
  allowedBrowserOrigins: string[];
}

export const DISCOVERY_POLICY_TTL_MS = 30_000;
let cached: { value: McpDiscoveryPolicy | null; loadedAt: number } | null = null;
let loading: Promise<McpDiscoveryPolicy | null> | null = null;
// Bumped on every clear, so a read that started before a save never repopulates the memo.
let generation = 0;

export async function loadDiscoveryPolicy(): Promise<McpDiscoveryPolicy | null> {
  if (cached && Date.now() - cached.loadedAt < DISCOVERY_POLICY_TTL_MS) return cached.value;
  if (loading) return loading;
  const started = generation;
  const pending = prisma.mcpPolicy
    .findUnique({
      where: { id: 'default' },
      select: {
        enabled: true,
        dcrEnabled: true,
        dcrScopes: true,
        cimdEnabled: true,
        cimdScopes: true,
        cimdAllowedHosts: true,
        allowedBrowserOrigins: true,
      },
    })
    .then(value => {
      if (started === generation) cached = { value, loadedAt: Date.now() };
      return value;
    });
  const settle = () => {
    if (loading === pending) loading = null;
  };
  pending.then(settle, settle);
  loading = pending;
  return pending;
}

/** Call after any policy write. */
export function clearDiscoveryPolicyCache() {
  generation += 1;
  cached = null;
  loading = null;
}

/** RFC 6749 §3.3 scope-token characters, so a value is safe inside a quoted challenge field. */
const SCOPE_TOKEN = /^[\x21\x23-\x5b\x5d-\x7e]+$/;

/**
 * The scopes a new client should ask for: the registration ceiling when automatic registration
 * is on, else the metadata-document ceiling. Never the union the protected-resource document
 * lists, which would steer clients to request more than a first connection needs.
 */
export function challengeScopes(policy: McpDiscoveryPolicy | null): string[] {
  if (!policy?.enabled) return [];
  const scopes = policy.dcrEnabled ? policy.dcrScopes : policy.cimdEnabled ? policy.cimdScopes : [];
  return scopes.filter(scope => scope !== 'admin:manage' && SCOPE_TOKEN.test(scope));
}
