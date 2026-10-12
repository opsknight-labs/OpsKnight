import { describe, expect, it } from 'vitest';
import {
  computeReportedLastError,
  determineActiveBlockingCondition,
  isTransientCommunicationError,
  type SafetyLimits,
} from '../../../agent/src/recovery';

const defaultLimits: SafetyLimits = {
  maxSpoolRecords: 100,
  maxSpoolBytes: 50 * 1024 * 1024,
  maxSpoolRecordAgeMs: 24 * 60 * 60 * 1000,
  maxDeadLetterRecords: 50,
  maxDeadLetterBytes: 25 * 1024 * 1024,
  maxDeadLetterAgeMs: 7 * 24 * 60 * 60 * 1000,
};

describe('Agent active blocking condition evaluation', () => {
  it('detects active safety thresholds and clears dynamically when state recovers', () => {
    // 1. Spool threshold exceeded
    const spoolThresholdState = {
      clockError: null,
      deadLetterStats: { count: 0, totalBytes: 0, oldestAgeMs: 0 },
      spoolStats: { count: 105, totalBytes: 60 * 1024 * 1024, oldestAgeMs: 1000 },
      isDraining: false,
      limits: defaultLimits,
    };
    expect(determineActiveBlockingCondition(spoolThresholdState)).toContain(
      'Spool threshold reached (105 records, 62914560 bytes)'
    );

    // When spool drains, condition clears dynamically to null without requiring restart
    const spoolDrainedState = {
      ...spoolThresholdState,
      spoolStats: { count: 0, totalBytes: 0, oldestAgeMs: 0 },
    };
    expect(determineActiveBlockingCondition(spoolDrainedState)).toBeNull();

    // 2. Dead-letter threshold exceeded
    const deadLetterState = {
      clockError: null,
      deadLetterStats: { count: 55, totalBytes: 30 * 1024 * 1024, oldestAgeMs: 1000 },
      spoolStats: { count: 0, totalBytes: 0, oldestAgeMs: 0 },
      isDraining: false,
      limits: defaultLimits,
    };
    expect(determineActiveBlockingCondition(deadLetterState)).toContain(
      'Dead-letter safety threshold reached (55 records, 31457280 bytes)'
    );

    // When operator cleans dead-letters, condition clears dynamically
    const deadLetterClearedState = {
      ...deadLetterState,
      deadLetterStats: { count: 0, totalBytes: 0, oldestAgeMs: 0 },
    };
    expect(determineActiveBlockingCondition(deadLetterClearedState)).toBeNull();

    // 3. Draining state
    expect(
      determineActiveBlockingCondition({
        clockError: null,
        deadLetterStats: { count: 0, totalBytes: 0, oldestAgeMs: 0 },
        spoolStats: { count: 0, totalBytes: 0, oldestAgeMs: 0 },
        isDraining: true,
        limits: defaultLimits,
      })
    ).toBe('Execution claims paused because Agent is draining.');

    // 4. Clock skew
    const constClockError = 'Agent clock differs from OpsKnight by 75s. Execution claims paused until clock is synchronized.';
    expect(
      determineActiveBlockingCondition({
        clockError: constClockError,
        deadLetterStats: { count: 0, totalBytes: 0, oldestAgeMs: 0 },
        spoolStats: { count: 0, totalBytes: 0, oldestAgeMs: 0 },
        isDraining: false,
        limits: defaultLimits,
      })
    ).toBe(constClockError);
  });
});

describe('Agent error precedence and lifecycle recovery', () => {
  it('correctly classifies transient communication errors vs operational outcomes', () => {
    expect(isTransientCommunicationError('Agent API temporarily unavailable.')).toBe(true);
    expect(isTransientCommunicationError('fetch failed: connect ECONNREFUSED 127.0.0.1:3000')).toBe(true);
    expect(isTransientCommunicationError('socket hang up')).toBe(true);
    expect(isTransientCommunicationError('HTTP 502 Bad Gateway')).toBe(true);
    expect(isTransientCommunicationError('HTTP 504 Gateway Timeout')).toBe(true);
    expect(isTransientCommunicationError(null)).toBe(false);
    expect(isTransientCommunicationError('LOCAL_POLICY_DENIED: KUBERNETES is not enabled')).toBe(false);
    expect(isTransientCommunicationError('Execution lease renewal failed.')).toBe(false);
  });

  it('preserves in-flight lease errors across background heartbeats until the execution completes', () => {
    let inFlightError: string | null = 'Execution lease renewal failed.';
    let transientCommunicationError: string | null = 'Agent API temporarily unavailable.';
    const activeBlockingError: string | null = null;

    // During active execution with renewal failure:
    // computeReportedLastError prioritizes inFlightError over transientError
    expect(
      computeReportedLastError({
        activeBlockingError,
        inFlightError,
        transientError: transientCommunicationError,
      })
    ).toBe('Execution lease renewal failed.');

    // When background heartbeat roundtrip succeeds, it clears transientCommunicationError:
    transientCommunicationError = null;

    // But heartbeat DOES NOT clear inFlightError while the attempt is still running!
    expect(
      computeReportedLastError({
        activeBlockingError,
        inFlightError,
        transientError: transientCommunicationError,
      })
    ).toBe('Execution lease renewal failed.');

    // Once the execution attempt finishes or is aborted, inFlightError is reset:
    inFlightError = null;

    // Agent is now completely healthy and no longer DEGRADED
    expect(
      computeReportedLastError({
        activeBlockingError,
        inFlightError,
        transientError: transientCommunicationError,
      })
    ).toBeNull();
  });

  it('demonstrates that draining a spool allows full recovery from DEGRADED state without restart', () => {
    let spoolCount = 120; // Above limit
    let transientCommunicationError: string | null = 'Agent API temporarily unavailable.';
    const inFlightError: string | null = null;

    // 1. Initial degraded state: spool threshold exceeded + network down
    let activeBlocking = determineActiveBlockingCondition({
      clockError: null,
      deadLetterStats: { count: 0, totalBytes: 0, oldestAgeMs: 0 },
      spoolStats: { count: spoolCount, totalBytes: 60 * 1024 * 1024, oldestAgeMs: 5000 },
      isDraining: false,
      limits: defaultLimits,
    });
    expect(activeBlocking).toContain('Spool threshold reached');
    expect(
      computeReportedLastError({
        activeBlockingError: activeBlocking,
        inFlightError,
        transientError: transientCommunicationError,
      })
    ).toContain('Spool threshold reached');

    // 2. Connectivity recovers: flushSpool drains the spool
    spoolCount = 0;
    transientCommunicationError = null; // Cleared by flushSpool when depth drops to 0

    activeBlocking = determineActiveBlockingCondition({
      clockError: null,
      deadLetterStats: { count: 0, totalBytes: 0, oldestAgeMs: 0 },
      spoolStats: { count: spoolCount, totalBytes: 0, oldestAgeMs: 0 },
      isDraining: false,
      limits: defaultLimits,
    });
    expect(activeBlocking).toBeNull();

    // 3. Next heartbeat reports lastError: null! Agent is healthy again.
    const reportedError = computeReportedLastError({
      activeBlockingError: activeBlocking,
      inFlightError,
      transientError: transientCommunicationError,
    });
    expect(reportedError).toBeNull();
  });
});
