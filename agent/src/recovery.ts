/**
 * OpsKnight Agent — State Evaluation, Error Recovery and Safety Logic.
 */

export interface SpoolStats {
  count: number;
  totalBytes: number;
  oldestAgeMs: number;
}

export interface SafetyLimits {
  maxSpoolRecords: number;
  maxSpoolBytes: number;
  maxSpoolRecordAgeMs: number;
  maxDeadLetterRecords: number;
  maxDeadLetterBytes: number;
  maxDeadLetterAgeMs: number;
}

export interface AgentConditionState {
  clockError: string | null;
  deadLetterStats: SpoolStats;
  spoolStats: SpoolStats;
  isDraining: boolean;
  limits: SafetyLimits;
}

/**
 * Dynamically determines if an active safety or operational condition currently blocks claims.
 * Evaluates live state (clock, dead-letter quarantine, spool backlog, draining) rather than
 * relying on static historical error strings.
 *
 * Returns the human-readable condition string, or null if the agent's current state is healthy.
 */
export function determineActiveBlockingCondition(state: AgentConditionState): string | null {
  if (state.clockError) {
    return state.clockError;
  }
  if (state.isDraining) {
    return 'Execution claims paused because Agent is draining.';
  }
  const { deadLetterStats, spoolStats, limits } = state;
  if (
    deadLetterStats.count >= limits.maxDeadLetterRecords ||
    deadLetterStats.totalBytes >= limits.maxDeadLetterBytes ||
    deadLetterStats.oldestAgeMs >= limits.maxDeadLetterAgeMs
  ) {
    return `Dead-letter safety threshold reached (${deadLetterStats.count} records, ${deadLetterStats.totalBytes} bytes). Halting ALL claims until operator resolves quarantined records.`;
  }
  if (
    spoolStats.count >= limits.maxSpoolRecords ||
    spoolStats.totalBytes >= limits.maxSpoolBytes ||
    spoolStats.oldestAgeMs >= limits.maxSpoolRecordAgeMs
  ) {
    return `Spool threshold reached (${spoolStats.count} records, ${spoolStats.totalBytes} bytes). Halting claims until backlog drains.`;
  }
  return null;
}

/**
 * Computes the effective error message to report to the control plane.
 *
 * Precedence:
 * 1. Active blocking condition (clock skew, dead-letter quarantine, spool backlog, draining).
 * 2. Terminal authentication/revocation error (revoked credentials, invalid token, HTTP 401/403).
 * 3. Local operational/filesystem error (EACCES, corrupt spool, unexpected runtime failure).
 * 4. Active in-flight execution error (e.g. lease renewal failure during active run).
 * 5. Last unresolved transient communication error (network or 5xx outage).
 * 6. null if healthy.
 */
export function computeReportedLastError(params: {
  activeBlockingError: string | null;
  terminalAuthError?: string | null;
  operationalError?: string | null;
  inFlightError?: string | null;
  transientError?: string | null;
}): string | null {
  if (params.activeBlockingError) return params.activeBlockingError;
  if (params.terminalAuthError) return params.terminalAuthError;
  if (params.operationalError) return params.operationalError;
  if (params.inFlightError) return params.inFlightError;
  return params.transientError ?? null;
}

/**
 * Determines whether an error string represents a transient network/HTTP communication blip
 * that should be cleared upon demonstrated communication recovery.
 */
export function isTransientCommunicationError(err: string | null): boolean {
  if (!err) return false;
  return (
    err === 'Agent API temporarily unavailable.' ||
    err.includes('ECONNREFUSED') ||
    err.includes('ETIMEDOUT') ||
    err.includes('ENOTFOUND') ||
    err.includes('socket hang up') ||
    err.includes('fetch failed') ||
    err.includes('502 Bad Gateway') ||
    err.includes('503 Service Unavailable') ||
    err.includes('504 Gateway Timeout') ||
    err.startsWith('HTTP 502') ||
    err.startsWith('HTTP 503') ||
    err.startsWith('HTTP 504') ||
    err.includes('Agent API server error: HTTP 5') ||
    err.includes('Agent API rate limit exceeded: HTTP 429')
  );
}
