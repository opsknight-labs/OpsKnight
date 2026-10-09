import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import { LeaseAuthority } from '../../../agent/src/lease';
import { ResultSpool } from '../../../agent/src/spool';
import {
  canonicalEnvelope,
  verifyExecutionEnvelope,
  verifyLeaseAcknowledgement,
} from '../../../agent/src/envelope';
import { AgentApiError } from '../../../agent/src/client';
import type { ClaimedAttempt } from '../../../agent/src/types';

afterEach(() => vi.useRealTimers());

describe('Agent authority and durable recovery', () => {
  it('quarantines corrupt records without blocking delivery and expires only old replay markers', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opsknight-spool-corrupt-'));
    try {
      const spool = new ResultSpool(directory);
      await spool.markStarted('old');
      await spool.markStarted('recent');
      const expired = new Date(Date.now() - 3 * 86400000);
      // Paths are confined to this test's freshly allocated temporary directory.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await utimes(join(directory, 'dispatched', 'old.started'), expired, expired);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await writeFile(join(directory, 'broken.json'), '{invalid');
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await writeFile(
        join(directory, 'broken2.json'),
        JSON.stringify({
          attemptId: 'broken2',
          leaseToken: 'token',
          producedAt: new Date().toISOString(),
          status: 'SUCCEEDED',
          localOutput: { malformed: true },
        })
      );
      await spool.put({
        attemptId: 'good',
        leaseToken: 'token',
        producedAt: new Date().toISOString(),
        status: 'SUCCEEDED',
      });
      expect((await spool.list()).map(record => record.attemptId)).toEqual(['good']);
      expect(await spool.deadLetterDepth()).toBe(2);
      expect(await spool.markStarted('recent')).toBe(false);
      expect(await spool.markStarted('old')).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('self-fences after renewal connectivity is lost', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const lease = new LeaseAuthority(controller, 10);
    lease.renew(new Date(Date.now() + 100).toISOString());
    await vi.advanceTimersByTimeAsync(90);
    expect(controller.signal.reason).toBe('LEASE_LOST');
    lease.dispose();
  });

  it('extends authority only after a successful renewal and rejects expired authority', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const lease = new LeaseAuthority(controller, 10);
    lease.renew(new Date(Date.now() + 100).toISOString());
    await vi.advanceTimersByTimeAsync(50);
    lease.renew(new Date(Date.now() + 100).toISOString());
    await vi.advanceTimersByTimeAsync(50);
    expect(controller.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(40);
    expect(controller.signal.reason).toBe('LEASE_LOST');
    lease.renew(new Date(Date.now() + 1000).toISOString());
    expect(controller.signal.aborted).toBe(true);
    lease.dispose();
  });

  it('retains result and full redacted output across restart and quarantines terminal rejection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opsknight-spool-test-'));
    try {
      const spool = new ResultSpool(directory);
      expect(await spool.markStarted('attempt1')).toBe(true);
      await spool.put({
        attemptId: 'attempt1',
        leaseToken: 'lease',
        producedAt: new Date().toISOString(),
        status: 'SUCCEEDED',
        localOutput: 'persisted output',
      });
      const restarted = new ResultSpool(directory);
      expect(await restarted.markStarted('attempt1')).toBe(false);
      expect(await restarted.list()).toMatchObject([
        { status: 'SUCCEEDED', localOutput: 'persisted output' },
      ]);
      await restarted.quarantine('attempt1');
      expect(await restarted.depth()).toBe(0);
      expect(await restarted.deadLetterDepth()).toBe(1);
      expect(new AgentApiError('stale', 409).terminal).toBe(true);
      expect(new AgentApiError('busy', 503).terminal).toBe(false);
      expect(new AgentApiError('rate limit', 429).terminal).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('authenticates commands, targets, secrets, and lease authority against a pinned key', () => {
    const keys = generateKeyPairSync('ed25519');
    const publicKey = keys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    const payload: ClaimedAttempt = {
      attemptId: 'attempt1',
      signingAgentId: 'agent1',
      executionId: 'execution1',
      executionDeadlineAt: new Date(Date.now() + 60000).toISOString(),
      leaseExpiresAt: new Date(Date.now() + 30000).toISOString(),
      definitionChecksum: 'a'.repeat(64),
      leaseToken: 'lease',
      planDigest: 'digest',
      idempotencyKey: 'idempotent',
      inputValues: { unit: 'api.service' },
      secretInputKeys: [],
      step: {
        key: 'status',
        name: 'Status',
        type: 'SYSTEMD',
        riskClass: 'READ_ONLY',
        config: { action: 'status', unit: 'api.service' },
        timeoutSeconds: 20,
      },
    };
    const signed = {
      ...payload,
      signature: sign(null, Buffer.from(canonicalEnvelope(payload)), keys.privateKey).toString(
        'base64'
      ),
    };
    expect(() => verifyExecutionEnvelope(signed, publicKey, 'agent1')).not.toThrow();
    expect(() =>
      verifyExecutionEnvelope(
        { ...signed, inputValues: { unit: 'payments.service' } },
        publicKey,
        'agent1'
      )
    ).toThrow(/signature/);
    expect(() => verifyExecutionEnvelope(signed, publicKey, 'agent2')).toThrow(/another Agent/);
    expect(() =>
      verifyExecutionEnvelope({ ...signed, signature: undefined }, publicKey, 'agent1')
    ).toThrow();
    const lease = {
      attemptId: 'attempt1',
      signingAgentId: 'agent1',
      leaseTokenHash: 'hash',
      leaseExpiresAt: payload.leaseExpiresAt,
      cancelRequested: false,
    };
    const acknowledgement = {
      ...lease,
      signature: sign(null, Buffer.from(canonicalEnvelope(lease)), keys.privateKey).toString(
        'base64'
      ),
    };
    expect(() =>
      verifyLeaseAcknowledgement(acknowledgement, publicKey, 'agent1', 'attempt1', 'hash')
    ).not.toThrow();
    expect(() =>
      verifyLeaseAcknowledgement(
        { ...acknowledgement, leaseExpiresAt: new Date(Date.now() + 999999).toISOString() },
        publicKey,
        'agent1',
        'attempt1',
        'hash'
      )
    ).toThrow();
  });

  it('records pre-start shutdown abort as CANCELLED', async () => {
    const { executeAttempt } = await import('../../../agent/src/executor');
    const policy = {
      allowedStepTypes: ['SYSTEMD', 'BASH'] as ('SYSTEMD' | 'BASH')[],
      allowNonIdempotent: true,
      maxRuntimeSeconds: 30,
      maxOutputBytes: 1024,
      systemdUnits: ['payments.service'],
      dockerContainers: [],
      kubernetesNamespaces: [],
      bashCommandPatterns: ['sleep 2'],
    };

    const controllerWrite = new AbortController();
    controllerWrite.abort('AGENT_SHUTDOWN');
    const attemptWrite: ClaimedAttempt = {
      attemptId: 'att-write-pre',
      signingAgentId: 'agent1',
      leaseToken: 'token',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      executionDeadlineAt: new Date(Date.now() + 60000).toISOString(),
      step: {
        key: 'step-1',
        name: 'Restart service',
        type: 'SYSTEMD',
        riskClass: 'NON_IDEMPOTENT',
        timeoutSeconds: 30,
        config: { action: 'restart', unit: 'payments.service' },
      },
      inputValues: {},
      secretInputKeys: [],
      idempotencyKey: null,
      planDigest: null,
      executionId: 'exec-1',
      signature: 'dummy',
    };

    const resultWrite = await executeAttempt(attemptWrite, policy, controllerWrite.signal);
    expect(resultWrite.status).toBe('CANCELLED');
    expect(resultWrite.errorCode).toBe('AGENT_INTERRUPTED_BY_SHUTDOWN');
  });

  it('records in-flight running write shutdown interrupt as UNKNOWN with AGENT_INTERRUPTED_BY_SHUTDOWN', async () => {
    const { executeAttempt } = await import('../../../agent/src/executor');
    const policy = {
      allowedStepTypes: ['BASH'] as 'BASH'[],
      allowNonIdempotent: true,
      maxRuntimeSeconds: 30,
      maxOutputBytes: 1024,
      systemdUnits: [],
      dockerContainers: [],
      kubernetesNamespaces: [],
      bashCommandPatterns: ['sleep 2'],
    };

    const controller = new AbortController();
    const attempt: ClaimedAttempt = {
      attemptId: 'att-write-running',
      signingAgentId: 'agent1',
      leaseToken: 'token',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      executionDeadlineAt: new Date(Date.now() + 60000).toISOString(),
      step: {
        key: 'step-write',
        name: 'In-flight Write',
        type: 'BASH',
        riskClass: 'NON_IDEMPOTENT',
        timeoutSeconds: 30,
        config: { command: 'sleep 2' },
      },
      inputValues: {},
      secretInputKeys: [],
      idempotencyKey: null,
      planDigest: null,
      executionId: 'exec-2',
      signature: 'dummy',
    };

    const executionPromise = executeAttempt(attempt, policy, controller.signal);
    // Allow process to spawn and enter active execution
    await new Promise(resolve => setTimeout(resolve, 80));
    controller.abort('AGENT_SHUTDOWN');

    const result = await executionPromise;
    expect(result.status).toBe('UNKNOWN');
    expect(result.errorCode).toBe('AGENT_INTERRUPTED_BY_SHUTDOWN');
  });

  it('records in-flight running read shutdown interrupt as CANCELLED with AGENT_SHUTDOWN', async () => {
    const { executeAttempt } = await import('../../../agent/src/executor');
    const policy = {
      allowedStepTypes: ['BASH'] as 'BASH'[],
      allowNonIdempotent: true,
      maxRuntimeSeconds: 30,
      maxOutputBytes: 1024,
      systemdUnits: [],
      dockerContainers: [],
      kubernetesNamespaces: [],
      bashCommandPatterns: ['sleep 2'],
    };

    const controller = new AbortController();
    const attempt: ClaimedAttempt = {
      attemptId: 'att-read-running',
      signingAgentId: 'agent1',
      leaseToken: 'token',
      leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
      executionDeadlineAt: new Date(Date.now() + 60000).toISOString(),
      step: {
        key: 'step-read',
        name: 'In-flight Read',
        type: 'BASH',
        riskClass: 'READ_ONLY',
        timeoutSeconds: 30,
        config: { command: 'sleep 2' },
      },
      inputValues: {},
      secretInputKeys: [],
      idempotencyKey: null,
      planDigest: null,
      executionId: 'exec-3',
      signature: 'dummy',
    };

    const executionPromise = executeAttempt(attempt, policy, controller.signal);
    // Allow process to spawn and enter active execution
    await new Promise(resolve => setTimeout(resolve, 80));
    controller.abort('AGENT_SHUTDOWN');

    const result = await executionPromise;
    expect(result.status).toBe('CANCELLED');
    expect(result.errorCode).toBe('AGENT_SHUTDOWN');
  });

  it('calculates spool stats accurately and exposes capacity metrics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opsknight-spool-stats-'));
    try {
      const spool = new ResultSpool(directory);
      await spool.initialize();
      const emptyStats = await spool.stats();
      expect(emptyStats).toEqual({ count: 0, totalBytes: 0, oldestAgeMs: 0 });

      await spool.put({
        attemptId: 'stat1',
        leaseToken: 'token1',
        producedAt: new Date().toISOString(),
        status: 'SUCCEEDED',
      });
      await spool.put({
        attemptId: 'stat2',
        leaseToken: 'token2',
        producedAt: new Date().toISOString(),
        status: 'FAILED',
      });

      const stats = await spool.stats();
      expect(stats.count).toBe(2);
      expect(stats.totalBytes).toBeGreaterThan(0);
      expect(stats.oldestAgeMs).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('calculates deadLetterStats accurately and exposes dead-letter capacity metrics', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'opsknight-deadletter-stats-'));
    try {
      const spool = new ResultSpool(directory);
      await spool.initialize();
      const emptyStats = await spool.deadLetterStats();
      expect(emptyStats).toEqual({ count: 0, totalBytes: 0, oldestAgeMs: 0 });

      await spool.put({
        attemptId: 'bad1',
        leaseToken: 'token1',
        producedAt: new Date().toISOString(),
        status: 'SUCCEEDED',
      });
      await spool.quarantine('bad1');

      const stats = await spool.deadLetterStats();
      expect(stats.count).toBe(1);
      expect(stats.totalBytes).toBeGreaterThan(0);
      expect(stats.oldestAgeMs).toBeGreaterThanOrEqual(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('fails closed on unexpected filesystem errors in stats calculation', async () => {
    // If the directory path is an invalid target (e.g. points to a regular file where directory is expected)
    const tempDir = await mkdtemp(join(tmpdir(), 'opsknight-not-a-dir-'));
    // Paths are confined to this test's freshly allocated temporary directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(join(tempDir, 'file'), 'not-a-directory');
    const filePath = join(tempDir, 'file');
    try {
      const spool = new ResultSpool(filePath);
      // stats() and deadLetterStats() should throw rather than masking the error as 0
      await expect(spool.stats()).rejects.toThrow();
      await expect(spool.deadLetterStats()).rejects.toThrow();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
