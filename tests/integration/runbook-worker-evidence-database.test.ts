import { describe, expect, it } from 'vitest';
import { recordWorkerHeartbeat, getRunbookWorkerEvidence } from '@/lib/runbooks/worker-heartbeats';
import { testPrisma } from '../helpers/test-db';
const suite = process.env.VITEST_USE_REAL_DB === '1' ? describe : describe.skip;
suite('durable runbook worker evidence', () => {
  it('tracks an idle worker, flags shutdown with an empty queue, and accepts a replacement', async () => {
    await testPrisma.runtimeWorkerHeartbeat.deleteMany();
    const now = new Date();
    const evidence = {
      instanceId: crypto.randomUUID(),
      lane: 'runbook',
      role: 'worker',
      runbookEnabled: true,
      running: true,
      lastSeenAt: now,
      lastSuccessAt: now,
      lastReconciledAt: now,
      lastError: null,
    };
    await recordWorkerHeartbeat(evidence);
    expect((await getRunbookWorkerEvidence(new Date())).status).toBe('HEALTHY');
    await recordWorkerHeartbeat({ ...evidence, running: false });
    expect((await getRunbookWorkerEvidence(new Date())).status).toBe('UNKNOWN');
    await recordWorkerHeartbeat({ ...evidence, instanceId: crypto.randomUUID() });
    expect((await getRunbookWorkerEvidence(new Date())).healthyInstances).toBe(1);
  });
  it('never treats a fresh process without reconciliation as dispatch ready', async () => {
    await testPrisma.runtimeWorkerHeartbeat.deleteMany();
    const now = new Date();
    await recordWorkerHeartbeat({
      instanceId: crypto.randomUUID(),
      lane: 'runbook',
      role: 'worker',
      runbookEnabled: true,
      running: true,
      lastSeenAt: now,
      lastSuccessAt: now,
      lastReconciledAt: null,
      lastError: null,
    });
    expect((await getRunbookWorkerEvidence(new Date())).status).toBe('UNKNOWN');
  });
});
