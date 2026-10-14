import { expect, it } from 'vitest';
import {
  evaluateRunbookWorkerEvidence,
  type WorkerEvidence,
} from '@/lib/runbooks/worker-health-contract';
const now = new Date('2026-10-13T12:00:00Z');
const worker: WorkerEvidence = {
  instanceId: 'worker',
  lane: 'runbook',
  running: true,
  lastSeenAt: now,
  lastSuccessAt: now,
  lastReconciledAt: now,
  lastError: null,
};
it('requires both dispatch and reconciliation evidence rather than a live idle process', () => {
  expect(evaluateRunbookWorkerEvidence([], now).status).toBe('UNKNOWN');
  expect(evaluateRunbookWorkerEvidence([{ ...worker, lastSuccessAt: null }], now).status).toBe(
    'UNKNOWN'
  );
  expect(evaluateRunbookWorkerEvidence([{ ...worker, lastReconciledAt: null }], now).status).toBe(
    'UNKNOWN'
  );
  expect(evaluateRunbookWorkerEvidence([worker], now).status).toBe('HEALTHY');
});
it('detects a stopped or killed worker within the 90-second evidence window even with no backlog', () => {
  expect(evaluateRunbookWorkerEvidence([{ ...worker, running: false }], now).status).toBe(
    'UNKNOWN'
  );
  expect(evaluateRunbookWorkerEvidence([worker], new Date(now.getTime() + 90_000)).status).toBe(
    'UNKNOWN'
  );
});
it('reports worker failures and rejects implausible future timestamps', () => {
  expect(
    evaluateRunbookWorkerEvidence([{ ...worker, lastError: 'reconciliation failed' }], now).status
  ).toBe('DEGRADED');
  expect(
    evaluateRunbookWorkerEvidence([{ ...worker, lastSeenAt: new Date(now.getTime() + 10000) }], now)
      .status
  ).toBe('UNKNOWN');
});
