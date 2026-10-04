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
});
