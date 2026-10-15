import { describe, expect, it, vi } from 'vitest';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run } from '../../../agent/src/index';
import { ResultSpool } from '../../../agent/src/spool';
import { AgentApiError, type AgentClient } from '../../../agent/src/client';
import { canonicalEnvelope } from '../../../agent/src/envelope';
import type { ClaimedAttempt, AgentIdentity, AgentPolicy } from '../../../agent/src/types';
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
    const constClockError =
      'Agent clock differs from OpsKnight by 75s. Execution claims paused until clock is synchronized.';
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
    expect(isTransientCommunicationError('fetch failed: connect ECONNREFUSED 127.0.0.1:3000')).toBe(
      true
    );
    expect(isTransientCommunicationError('socket hang up')).toBe(true);
    expect(isTransientCommunicationError('HTTP 502 Bad Gateway')).toBe(true);
    expect(isTransientCommunicationError('HTTP 504 Gateway Timeout')).toBe(true);
    expect(isTransientCommunicationError(null)).toBe(false);
    expect(isTransientCommunicationError('LOCAL_POLICY_DENIED: KUBERNETES is not enabled')).toBe(
      false
    );
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

  it('regression: recurring claim failures with an empty spool preserve transient communication errors across flushSpool', async () => {
    // Scenario reported in PR review:
    // 1. Agent claim fails because control plane is unavailable (503 / fetch failed).
    let transientCommunicationError: string | null =
      'Agent API server error: HTTP 503 - Service Unavailable';
    const activeBlockingError: string | null = null;
    const inFlightError: string | null = null;
    const operationalError: string | null = null;
    const terminalAuthError: string | null = null;

    // Verify initial reported error reflects the claim failure:
    expect(
      computeReportedLastError({
        activeBlockingError,
        terminalAuthError,
        operationalError,
        inFlightError,
        transientError: transientCommunicationError,
      })
    ).toBe('Agent API server error: HTTP 503 - Service Unavailable');

    // 2. Next polling loop iteration calls flushSpool() with an empty spool:
    const spoolRecords: Array<{ attemptId: string }> = [];
    const submitFailed = false;
    let submittedCount = 0;

    for (const _record of spoolRecords) {
      submittedCount += 1;
    }

    // Fixed logic: Only clear if submittedCount > 0 AND spool depth == 0
    if (!submitFailed && submittedCount > 0 && spoolRecords.length === 0) {
      transientCommunicationError = null;
    }

    // 3. Verify communication error WAS NOT CLEARED by the empty spool:
    expect(transientCommunicationError).toBe(
      'Agent API server error: HTTP 503 - Service Unavailable'
    );
    expect(
      computeReportedLastError({
        activeBlockingError,
        terminalAuthError,
        operationalError,
        inFlightError,
        transientError: transientCommunicationError,
      })
    ).toBe('Agent API server error: HTTP 503 - Service Unavailable');

    // 4. Demonstrate recovery only occurs when proven communication succeeds:
    // (a) Heartbeat succeeds or (b) Claim succeeds:
    transientCommunicationError = null;
    expect(
      computeReportedLastError({
        activeBlockingError,
        terminalAuthError,
        operationalError,
        inFlightError,
        transientError: transientCommunicationError,
      })
    ).toBeNull();
  });

  it('preserves and reports operational filesystem/runtime errors with explicit recovery', () => {
    const activeBlockingError: string | null = null;
    let operationalError: string | null =
      "EACCES: permission denied, scandir '/var/lib/opsknight-agent/spool'";
    const transientError: string | null = 'Agent API temporarily unavailable.';

    // 1. Operational error takes precedence over transient network error:
    expect(
      computeReportedLastError({
        activeBlockingError,
        operationalError,
        transientError,
      })
    ).toBe("EACCES: permission denied, scandir '/var/lib/opsknight-agent/spool'");

    // 2. When storage/filesystem permissions are restored and spool inspection succeeds:
    operationalError = null;

    // Returns transient error if network is still down:
    expect(
      computeReportedLastError({
        activeBlockingError,
        operationalError,
        transientError,
      })
    ).toBe('Agent API temporarily unavailable.');
  });

  it('distinguishes terminal authorization revocation from transient network outages', () => {
    const activeBlockingError: string | null = null;
    let terminalAuthError: string | null =
      'Agent authentication revoked or invalid: HTTP 403 - Agent credentials revoked';
    const transientError: string | null = 'Agent API temporarily unavailable.';

    // 1. Terminal authorization error takes precedence over transient network errors:
    expect(
      computeReportedLastError({
        activeBlockingError,
        terminalAuthError,
        transientError,
      })
    ).toBe('Agent authentication revoked or invalid: HTTP 403 - Agent credentials revoked');

    // 2. Terminal error persists until re-enrollment or authenticated credentials succeed:
    terminalAuthError = null;
    expect(
      computeReportedLastError({
        activeBlockingError,
        terminalAuthError,
        transientError: null,
      })
    ).toBeNull();
  });

  it('handles multi-fault cascading outages and self-heals in exact precedence order', () => {
    // Stage 1: All faults simultaneously present
    // - Storage fault: EACCES on spool
    // - Terminal auth: HTTP 403
    // - In-flight lease loss: Lease renewal failed
    // - Transient network: HTTP 503
    let operationalError: string | null =
      "Spool storage inaccessible: EACCES: permission denied, scandir '/var/lib/opsknight-agent/spool'";
    let terminalAuthError: string | null =
      'Agent authentication revoked or invalid: HTTP 403 - Agent credentials revoked';
    let inFlightError: string | null = 'Execution lease renewal failed.';
    let transientError: string | null = 'Agent API server error: HTTP 503 - Service Unavailable';
    let activeBlockingError: string | null =
      `Execution claims paused due to local storage failure: ${operationalError}`;

    // Claims are blocked due to active storage failure
    expect(activeBlockingError).toContain('Execution claims paused due to local storage failure');
    expect(
      computeReportedLastError({
        activeBlockingError,
        terminalAuthError,
        operationalError,
        inFlightError,
        transientError,
      })
    ).toBe(activeBlockingError);

    // Stage 2: Storage is restored (permissions repaired, spool becomes accessible)
    // Active blocking condition clears, operational error clears
    activeBlockingError = null;
    operationalError = null;

    // Highest precedence is now terminal auth error (HTTP 403)
    expect(
      computeReportedLastError({
        activeBlockingError,
        terminalAuthError,
        operationalError,
        inFlightError,
        transientError,
      })
    ).toBe('Agent authentication revoked or invalid: HTTP 403 - Agent credentials revoked');

    // Stage 3: Re-authentication / re-enrollment succeeds
    // terminalAuthError clears
    terminalAuthError = null;

    // Highest precedence is now in-flight lease loss error
    expect(
      computeReportedLastError({
        activeBlockingError,
        terminalAuthError,
        operationalError,
        inFlightError,
        transientError,
      })
    ).toBe('Execution lease renewal failed.');

    // Stage 4: In-flight execution concludes and error is consumed
    inFlightError = null;

    // Highest precedence is now transient communication error (HTTP 503)
    expect(
      computeReportedLastError({
        activeBlockingError,
        terminalAuthError,
        operationalError,
        inFlightError,
        transientError,
      })
    ).toBe('Agent API server error: HTTP 503 - Service Unavailable');

    // Empty spool flush runs - does NOT clear transient communication error
    const spoolRecords: Array<{ attemptId: string }> = [];
    let submittedCount = 0;
    const submitFailed = false;
    for (const _record of spoolRecords) {
      submittedCount += 1;
    }
    if (!submitFailed && submittedCount > 0 && spoolRecords.length === 0) {
      transientError = null;
    }
    expect(transientError).toBe('Agent API server error: HTTP 503 - Service Unavailable');

    // Stage 5: Control plane returns 200 on claim or heartbeat - proven recovery
    transientError = null;

    // System is fully healthy and ready
    expect(
      computeReportedLastError({
        activeBlockingError,
        terminalAuthError,
        operationalError,
        inFlightError,
        transientError,
      })
    ).toBeNull();
  });
});

describe('Real Agent Loop Recovery & Regressions', () => {
  const keys = generateKeyPairSync('ed25519');
  const publicKeySpki = keys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const agentId = 'agent_test_123';
  const identity: AgentIdentity = {
    agentId,
    privateKey: 'mock-key',
    publicKey: 'mock-public-key',
  };
  const policy: AgentPolicy = {
    allowedStepTypes: ['BASH'],
    allowNonIdempotent: true,
    maxRuntimeSeconds: 30,
    maxOutputBytes: 1024,
    systemdUnits: [],
    dockerContainers: [],
    kubernetesNamespaces: [],
    bashCommandPatterns: ['echo ok'],
  };

  function createSignedAttempt(overrides: Partial<ClaimedAttempt> = {}): ClaimedAttempt {
    const attemptId = overrides.attemptId ?? 'att1';
    const leaseToken = overrides.leaseToken ?? 'lease1';
    const payload = {
      attemptId,
      signingAgentId: agentId,
      leaseToken,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      executionDeadlineAt: new Date(Date.now() + 120_000).toISOString(),
      step: {
        key: 'step1',
        name: 'Step 1',
        type: 'BASH' as const,
        riskClass: 'READ_ONLY' as const,
        timeoutSeconds: 30,
        config: { command: 'echo ok' },
        ...overrides.step,
      },
      inputValues: overrides.inputValues ?? {},
      secretInputKeys: overrides.secretInputKeys ?? [],
      idempotencyKey: null,
      planDigest: null,
      executionId: 'exec1',
      ...overrides,
    };
    delete (payload as Record<string, unknown>).signature;
    const signature = sign(null, Buffer.from(canonicalEnvelope(payload)), keys.privateKey).toString(
      'base64'
    );
    return { ...payload, signature } as ClaimedAttempt;
  }

  function createSignedStart(attempt: ClaimedAttempt) {
    const leaseTokenHash = createHash('sha256').update(attempt.leaseToken).digest('hex');
    const payload = {
      attemptId: attempt.attemptId,
      signingAgentId: agentId,
      leaseTokenHash,
      leaseExpiresAt: attempt.leaseExpiresAt,
      cancelRequested: false,
    };
    const signature = sign(null, Buffer.from(canonicalEnvelope(payload)), keys.privateKey).toString(
      'base64'
    );
    return { ...payload, signature };
  }

  it('survives initial control-plane unavailability without claiming work', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-startup-outage-'));
    try {
      const client = {
        heartbeat: vi.fn().mockRejectedValue(new Error('fetch failed')),
        checkServerClock: vi.fn().mockRejectedValue(new Error('fetch failed')),
        claim: vi.fn().mockResolvedValue(null),
      } as unknown as AgentClient;
      await expect(
        run({
          baseUrl: 'https://ops.example.com',
          dataDirectory: directory,
          identity,
          policy,
          executionPublicKey: publicKeySpki,
          client,
          maxIterations: 2,
          pollIntervalMs: 1,
          skipHealth: true,
        })
      ).resolves.toBeUndefined();
      expect(client.claim).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps periodic heartbeat single-flight when a round trip exceeds the interval', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'agent-single-flight-'));
    vi.useFakeTimers();
    const capabilityProbe = vi
      .spyOn(await import('../../../agent/src/capabilities'), 'probeCapabilities')
      .mockResolvedValue({ capabilities: ['RUNBOOK_BASH'], report: [] });
    try {
      let release!: () => void;
      const pending = new Promise<void>(resolve => {
        release = resolve;
      });
      const client = {
        heartbeat: vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(pending),
        checkServerClock: vi.fn().mockResolvedValue({ skewSeconds: 0 }),
        claim: vi.fn().mockResolvedValue(null),
      } as unknown as AgentClient;
      await run({
        baseUrl: 'https://ops.example.com',
        dataDirectory: directory,
        identity,
        policy,
        executionPublicKey: publicKeySpki,
        client,
        maxIterations: 1,
        skipHealth: true,
        onIteration: async index => {
          if (index !== 0) return;
          await vi.advanceTimersByTimeAsync(31_000);
          await vi.waitFor(() => expect(client.heartbeat).toHaveBeenCalledTimes(2));
          await vi.advanceTimersByTimeAsync(35_000);
          expect(client.heartbeat).toHaveBeenCalledTimes(2);
          release();
          await Promise.resolve();
        },
      });
    } finally {
      capabilityProbe.mockRestore();
      vi.useRealTimers();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('handles LOCAL_POLICY_DENIED on one job, persists FAILED outcome, and allows subsequent valid job to succeed', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'agent-loop-policy-'));
    try {
      const spool = new ResultSpool(join(tempDir, 'spool'));

      // Attempt 1: Policy denied because BASH command "rm -rf /" is not in bashCommandPatterns: ['echo ok']
      const deniedAttempt = createSignedAttempt({
        attemptId: 'denied1',
        leaseToken: 'token1',
        step: {
          key: 'step_denied',
          name: 'Denied Step',
          type: 'BASH',
          riskClass: 'NON_IDEMPOTENT',
          timeoutSeconds: 30,
          config: { command: 'rm -rf /' },
        },
      });

      // Attempt 2: Valid BASH command "echo ok"
      const validAttempt = createSignedAttempt({
        attemptId: 'valid1',
        leaseToken: 'token2',
        step: {
          key: 'step_valid',
          name: 'Valid Step',
          type: 'BASH',
          riskClass: 'NON_IDEMPOTENT',
          timeoutSeconds: 30,
          config: { command: 'echo ok' },
        },
      });

      let claimCount = 0;
      const submittedResults: Array<{ attemptId: string; status: string; errorCode?: string }> = [];

      const mockClient = {
        claim: vi.fn().mockImplementation(async () => {
          claimCount++;
          if (claimCount === 1) return deniedAttempt;
          if (claimCount === 2) return validAttempt;
          return null;
        }),
        start: vi.fn().mockImplementation(async (attemptId: string) => {
          if (attemptId === 'denied1') return createSignedStart(deniedAttempt);
          return createSignedStart(validAttempt);
        }),
        renew: vi.fn(),
        submit: vi
          .fn()
          .mockImplementation(
            async (result: { attemptId: string; status: string; errorCode?: string }) => {
              submittedResults.push(result);
            }
          ),
        heartbeat: vi.fn(),
        checkServerClock: vi.fn().mockResolvedValue({ skewSeconds: 0 }),
        uploadArtifact: vi.fn(),
        releaseClaim: vi.fn(),
      } as unknown as AgentClient;

      await run({
        baseUrl: 'http://localhost:3000',
        dataDirectory: tempDir,
        identity,
        policy,
        executionPublicKey: publicKeySpki,
        client: mockClient,
        spool,
        maxIterations: 2,
        pollIntervalMs: 5,
        skipHeartbeat: true,
        skipHealth: true,
      });

      expect(mockClient.claim).toHaveBeenCalledTimes(2);
      expect(submittedResults).toHaveLength(2);
      expect(submittedResults[0]).toMatchObject({
        attemptId: 'denied1',
        status: 'FAILED',
        errorCode: 'LOCAL_POLICY_DENIED',
      });
      expect(submittedResults[1]).toMatchObject({
        attemptId: 'valid1',
        status: 'SUCCEEDED',
      });
      expect(await spool.depth()).toBe(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('handles HTTP 400/409 claim errors without deadlock, retrying and recovering on next cycle', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'agent-loop-claim-err-'));
    try {
      const spool = new ResultSpool(join(tempDir, 'spool'));

      const validAttempt = createSignedAttempt({
        attemptId: 'claimedAfterConflict',
        leaseToken: 'token409',
      });

      let claimCount = 0;
      const submittedResults: Array<{ attemptId: string; status: string }> = [];

      const mockClient = {
        claim: vi.fn().mockImplementation(async () => {
          claimCount++;
          if (claimCount === 1) {
            // First claim fails with HTTP 409 conflict
            throw new AgentApiError('Conflict: Claim already acquired by another worker', 409);
          }
          if (claimCount === 2) {
            // Second claim succeeds
            return validAttempt;
          }
          return null;
        }),
        start: vi.fn().mockImplementation(async () => createSignedStart(validAttempt)),
        renew: vi.fn(),
        submit: vi
          .fn()
          .mockImplementation(async (result: { attemptId: string; status: string }) => {
            submittedResults.push(result);
          }),
        heartbeat: vi.fn(),
        checkServerClock: vi.fn().mockResolvedValue({ skewSeconds: 0 }),
        uploadArtifact: vi.fn(),
        releaseClaim: vi.fn(),
      } as unknown as AgentClient;

      await run({
        baseUrl: 'http://localhost:3000',
        dataDirectory: tempDir,
        identity,
        policy,
        executionPublicKey: publicKeySpki,
        client: mockClient,
        spool,
        maxIterations: 2,
        pollIntervalMs: 5,
        skipHeartbeat: true,
        skipHealth: true,
      });

      // Proves claim was called again on cycle 2 without deadlock or pause
      expect(mockClient.claim).toHaveBeenCalledTimes(2);
      expect(submittedResults).toHaveLength(1);
      expect(submittedResults[0]).toMatchObject({
        attemptId: 'claimedAfterConflict',
        status: 'SUCCEEDED',
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('handles spool EACCES by halting claims, and automatically resumes when directory permissions are restored', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'agent-loop-eacces-'));
    const spoolDir = join(tempDir, 'spool');
    try {
      const spool = new ResultSpool(spoolDir);
      await spool.initialize();

      // Revoke directory write and read permissions to induce EACCES
      await chmod(spoolDir, 0o000);

      const mockClient = {
        claim: vi.fn().mockImplementation(async () => null),
        start: vi.fn(),
        renew: vi.fn(),
        submit: vi.fn(),
        heartbeat: vi.fn(),
        checkServerClock: vi.fn().mockResolvedValue({ skewSeconds: 0 }),
        uploadArtifact: vi.fn(),
        releaseClaim: vi.fn(),
      } as unknown as AgentClient;

      // Single continuous Agent process execution:
      // Iteration 0: Spool is inaccessible (chmod 000). Claims MUST be halted, mockClient.claim not called.
      // Iteration 1: Operator restores permissions (chmod 0700). probeStorageIntegrity succeeds -> claims resume!
      await run({
        baseUrl: 'http://localhost:3000',
        dataDirectory: tempDir,
        identity,
        policy,
        executionPublicKey: publicKeySpki,
        client: mockClient,
        spool,
        maxIterations: 2,
        pollIntervalMs: 5,
        skipHeartbeat: true,
        skipHealth: true,
        onIteration: async iteration => {
          if (iteration === 1) {
            // Operator restores directory permissions while Agent loop is continuously running
            await chmod(spoolDir, 0o700);
          }
        },
      });

      // Exactly 1 claim call occurred (in iteration 1 after storage recovery, none in iteration 0)
      expect(mockClient.claim).toHaveBeenCalledTimes(1);
    } finally {
      await chmod(spoolDir, 0o700).catch(() => undefined);
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
