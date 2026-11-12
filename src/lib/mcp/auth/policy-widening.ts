/**
 * Which MCP policy changes widen what assistants can do. Widening needs a recent sign-in
 * (requireFreshMcpAdmin); narrowing (turning things off, lowering limits) never does, so an
 * administrator answering an incident is never blocked from shutting access down.
 */

export const MCP_REAUTHENTICATION_REQUIRED = 'MCP_REAUTHENTICATION_REQUIRED' as const;
export const MCP_REAUTHENTICATION_MESSAGE =
  'This change gives assistants more access, so confirm it is you: sign in again, then save.';

export interface McpPolicyAccess {
  enabled: boolean;
  writesEnabled: boolean;
  sensitiveReadsEnabled: boolean;
  dcrEnabled: boolean;
  cimdEnabled: boolean;
  dcrScopes: readonly string[];
  cimdScopes: readonly string[];
  cimdAllowedHosts: readonly string[];
  allowedBrowserOrigins: readonly string[];
  requestsPerMinute: number;
  maxInFlight: number;
  maxOperations: number;
  sessionIdleDays: number;
  approvalTtlMinutes: number;
  approvalCommitWindowMinutes: number;
  patEnabled: boolean;
  patMaxDays: number;
  patAllowedScopes: readonly string[];
  requireReadOnlyConnections: boolean;
  deviceFlowEnabled: boolean;
  /** Strict four-eyes for approvals; turning it off lets administrators approve their own requests. */
  requireDistinctReviewer?: boolean;
  /** Routine responder changes run without a review; turning it on widens what assistants can do. */
  responderDirectWritesEnabled?: boolean;
  /** Optional cap on one person's requests per minute across connections; null or unset is off. */
  perUserRequestsPerMinute?: number | null;
}

type Access = McpPolicyAccess;
const SWITCHES: [string, (policy: Access) => boolean][] = [
  ['enabled', policy => policy.enabled],
  ['writesEnabled', policy => policy.writesEnabled],
  ['sensitiveReadsEnabled', policy => policy.sensitiveReadsEnabled],
  ['dcrEnabled', policy => policy.dcrEnabled],
  ['cimdEnabled', policy => policy.cimdEnabled],
  ['patEnabled', policy => policy.patEnabled],
  // Device sign-in opens a path where the approving browser is not the device that gets tokens.
  ['deviceFlowEnabled', policy => policy.deviceFlowEnabled],
  // Lifting the view-only cap lets every connection use its change scopes again.
  ['requireReadOnlyConnections', policy => !policy.requireReadOnlyConnections],
  // Lifting strict four-eyes lets an administrator approve what their own assistant prepared.
  ['requireDistinctReviewer', policy => !policy.requireDistinctReviewer],
  ['responderDirectWritesEnabled', policy => policy.responderDirectWritesEnabled === true],
];
const LIMITS: [string, (policy: Access) => number][] = [
  ['requestsPerMinute', policy => policy.requestsPerMinute],
  ['maxInFlight', policy => policy.maxInFlight],
  ['maxOperations', policy => policy.maxOperations],
  ['sessionIdleDays', policy => policy.sessionIdleDays],
  ['approvalTtlMinutes', policy => policy.approvalTtlMinutes],
  ['approvalCommitWindowMinutes', policy => policy.approvalCommitWindowMinutes],
];

const gains = (before: readonly string[], after: readonly string[]) =>
  after.some(item => !before.includes(item));

/** The names of the settings this save widens; empty when it only narrows or keeps access. */
export function mcpPolicyWidening(before: McpPolicyAccess, after: McpPolicyAccess): string[] {
  const widened: string[] = [];
  for (const [name, read] of SWITCHES) if (read(after) && !read(before)) widened.push(name);
  for (const [name, read] of LIMITS) if (read(after) > read(before)) widened.push(name);
  if (gains(before.dcrScopes, after.dcrScopes)) widened.push('dcrScopes');
  if (gains(before.cimdScopes, after.cimdScopes)) widened.push('cimdScopes');
  if (gains(before.allowedBrowserOrigins, after.allowedBrowserOrigins))
    widened.push('allowedBrowserOrigins');
  // The per-person cap: removing it, or raising it, lets one person make more requests.
  const capBefore = before.perUserRequestsPerMinute ?? Number.POSITIVE_INFINITY;
  const capAfter = after.perUserRequestsPerMinute ?? Number.POSITIVE_INFINITY;
  if (capAfter > capBefore) widened.push('perUserRequestsPerMinute');
  // Personal-token limits matter only while personal tokens can be created.
  if (after.patEnabled && after.patMaxDays > before.patMaxDays) widened.push('patMaxDays');
  if (after.patEnabled && gains(before.patAllowedScopes, after.patAllowedScopes))
    widened.push('patAllowedScopes');
  // An empty trusted-host list allows any public host; adding a host while CIMD is on trusts it.
  if (
    (before.cimdAllowedHosts.length > 0 && after.cimdAllowedHosts.length === 0) ||
    (after.cimdEnabled &&
      before.cimdAllowedHosts.length > 0 &&
      gains(before.cimdAllowedHosts, after.cimdAllowedHosts))
  )
    widened.push('cimdAllowedHosts');
  return widened;
}

/** Re-exposing a capability an administrator had turned off widens access. */
export function capabilitiesWiden(
  storedDisabled: readonly string[],
  nextDisabled: readonly string[]
) {
  return storedDisabled.some(entry => !nextDisabled.includes(entry));
}
