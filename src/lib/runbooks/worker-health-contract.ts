export const WORKER_EVIDENCE_MAX_AGE_MS = 90_000;
export type WorkerEvidence = {
  instanceId: string;
  lane: string;
  running: boolean;
  lastSeenAt: Date;
  lastSuccessAt: Date | null;
  lastReconciledAt: Date | null;
  lastError: string | null;
};
export type WorkerHealthEvidence = {
  status: 'HEALTHY' | 'DEGRADED' | 'UNKNOWN';
  instances: number;
  healthyInstances: number;
  reason: string;
  expectedInstances?: number | null;
  redundancy?: 'SATISFIED' | 'DEGRADED' | 'UNCONFIGURED';
};
export function evaluateRunbookWorkerEvidence(
  workers: WorkerEvidence[],
  now: Date,
  expectedInstances: number | null = null
): WorkerHealthEvidence {
  const fresh = (date: Date | null) =>
    date !== null &&
    now.getTime() - date.getTime() >= -5000 &&
    now.getTime() - date.getTime() < WORKER_EVIDENCE_MAX_AGE_MS;
  const running = workers.filter(worker => worker.running && fresh(worker.lastSeenAt));
  const usable = running.filter(
    worker => fresh(worker.lastSuccessAt) && fresh(worker.lastReconciledAt) && !worker.lastError
  );
  const redundancyLost = expectedInstances !== null && usable.length < expectedInstances;
  return {
    expectedInstances,
    redundancy:
      expectedInstances === null ? 'UNCONFIGURED' : redundancyLost ? 'DEGRADED' : 'SATISFIED',
    status:
      running.some(worker => worker.lastError) || (usable.length > 0 && redundancyLost)
        ? ('DEGRADED' as const)
        : usable.length
          ? ('HEALTHY' as const)
          : ('UNKNOWN' as const),
    instances: running.length,
    healthyInstances: usable.length,
    reason: redundancyLost
      ? `${usable.length}/${expectedInstances} expected workers have fresh dispatch and reconciliation evidence.`
      : running.some(worker => worker.lastError)
        ? 'One or more fresh runbook workers reported a fault. Inspect lane logs.'
        : usable.length
          ? `Fresh dispatch and reconciliation evidence available. ${expectedInstances === null ? 'Expected worker count is not configured; redundancy is unverified.' : `${usable.length}/${expectedInstances} expected workers healthy.`}`
          : running.length
            ? 'Worker dispatch or reconciliation evidence is stale, incomplete or faulted.'
            : 'No fresh runbook worker heartbeat. Check the runbook worker deployment.',
  };
}
