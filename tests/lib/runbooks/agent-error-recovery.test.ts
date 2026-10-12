import { describe, expect, it } from 'vitest';
import { isPersistentFailure } from '../../../agent/src/recovery';

describe('Agent error classification and recovery', () => {
  it('correctly classifies persistent safety and policy errors', () => {
    expect(
      isPersistentFailure('Spool threshold reached (50 records, 1048576 bytes). Halting claims until backlog drains.')
    ).toBe(true);

    expect(
      isPersistentFailure(
        'Dead-letter safety threshold reached (10 records, 524288 bytes). Halting ALL claims until operator resolves quarantined records.'
      )
    ).toBe(true);

    expect(
      isPersistentFailure('LOCAL_POLICY_DENIED: Docker container untrusted-app is not allowlisted.')
    ).toBe(true);

    expect(
      isPersistentFailure('Agent clock differs from OpsKnight by 95s. Execution claims paused until clock is synchronized.')
    ).toBe(true);

    expect(
      isPersistentFailure('Initial clock synchronization check with control plane failed. Execution claims paused.')
    ).toBe(true);

    expect(
      isPersistentFailure('Execution claim released because Agent is draining.')
    ).toBe(true);

    expect(
      isPersistentFailure('Write action claim released because result backlog (5) or dead letters (0) exist.')
    ).toBe(true);
  });

  it('correctly classifies transient communication errors as non-persistent', () => {
    expect(isPersistentFailure('Agent API temporarily unavailable.')).toBe(false);
    expect(isPersistentFailure('fetch failed: connect ECONNREFUSED 127.0.0.1:3000')).toBe(false);
    expect(isPersistentFailure('socket hang up')).toBe(false);
    expect(isPersistentFailure('HTTP 502 Bad Gateway')).toBe(false);
    expect(isPersistentFailure('HTTP 504 Gateway Timeout')).toBe(false);
    expect(isPersistentFailure('Execution lease renewal failed.')).toBe(false);
    expect(isPersistentFailure(null)).toBe(false);
    expect(isPersistentFailure('')).toBe(false);
  });

  it('demonstrates that transient errors clear upon communication recovery while persistent errors are retained', () => {
    // Simulated state machine for agent heartbeat and claim recovery
    let lastError: string | null = 'Agent API temporarily unavailable.';
    let clockError: string | null = null;

    // 1. Transient error recovered after successful heartbeat/claim
    if (lastError && !isPersistentFailure(lastError) && clockError === null) {
      lastError = null;
    }
    expect(lastError).toBeNull();

    // 2. Persistent policy denial remains active even after communication roundtrip
    lastError = 'LOCAL_POLICY_DENIED: KUBERNETES is not enabled on this Agent.';
    if (lastError && !isPersistentFailure(lastError) && clockError === null) {
      lastError = null;
    }
    expect(lastError).toBe('LOCAL_POLICY_DENIED: KUBERNETES is not enabled on this Agent.');

    // 3. Persistent dead letter threshold remains active
    lastError = 'Dead-letter safety threshold reached (10 records, 100000 bytes). Halting ALL claims until operator resolves quarantined records.';
    if (lastError && !isPersistentFailure(lastError) && clockError === null) {
      lastError = null;
    }
    expect(lastError).toContain('Dead-letter safety threshold reached');
  });
});
