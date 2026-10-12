/**
 * OpsKnight Agent — Error Classification and Recovery Helpers.
 */

/**
 * Returns true if the error represents an active, persistent safety or operational condition
 * that MUST NOT be cleared by a transient communication roundtrip or idle poll cycle.
 */
export function isPersistentFailure(err: string | null): boolean {
  if (!err) return false;
  return (
    err.startsWith('Dead-letter safety threshold') ||
    err.startsWith('Spool threshold') ||
    err.startsWith('LOCAL_POLICY_DENIED') ||
    err.startsWith('Agent clock differs') ||
    err.startsWith('Initial clock synchronization') ||
    err.startsWith('Execution claim released because Agent is draining') ||
    err.startsWith('Write action claim released because result backlog')
  );
}
