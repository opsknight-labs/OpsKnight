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
export function evaluateRunbookWorkerEvidence(workers: WorkerEvidence[], now: Date) {
  const fresh = (date: Date | null) =>
    date !== null &&
    now.getTime() - date.getTime() >= -5000 &&
    now.getTime() - date.getTime() < WORKER_EVIDENCE_MAX_AGE_MS;
  const running = workers.filter(worker => worker.running && fresh(worker.lastSeenAt));
  const usable = running.filter(
    worker => fresh(worker.lastSuccessAt) && fresh(worker.lastReconciledAt) && !worker.lastError
  );
  return {
    status: running.some(worker => worker.lastError)
      ? ('DEGRADED' as const)
      : usable.length
        ? ('HEALTHY' as const)
        : ('UNKNOWN' as const),
    instances: running.length,
    healthyInstances: usable.length,
    reason: running.some(worker => worker.lastError)
      ? 'One or more fresh runbook workers reported a fault. Inspect lane logs.'
      : usable.length
        ? 'Fresh dispatch and reconciliation evidence available.'
        : running.length
          ? 'Worker dispatch or reconciliation evidence is stale, incomplete or faulted.'
          : 'No fresh runbook worker heartbeat. Check the runbook worker deployment.',
  };
}
