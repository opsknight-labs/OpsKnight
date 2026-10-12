# OpsKnight Runbooks Certification — 05. Fault Tolerance & Failure Handling

**Audit Date:** 2026-10-12  
**Commit:** `ea38c8c5601189225e3c5edd1efeed855c034c7d`  

---

## 1. Risk Classification & Retry Invariants

Every step in an OpsKnight Runbook has an explicit risk classification governing how failures and timeouts are handled:

| Risk Class | Description | Retry on Failure | Retry on UNKNOWN Outcome |
| :--- | :--- | :---: | :---: |
| **`READ_ONLY`** | Diagnostics, metrics gathering, inspection | YES (Up to max configured) | YES |
| **`IDEMPOTENT_WRITE`** | Restarting a service, setting replica counts, applying state | YES (Up to max configured) | NO (Fails closed unless human overrides) |
| **`NON_IDEMPOTENT`** | Arbitrary shell script, external webhooks | NO | NEVER |

### Formal Helper Logic
```typescript
export function isSafeToRetryAfterUnknown(riskClass: RunbookRiskClass): boolean {
  return riskClass === 'READ_ONLY';
}

export function isRetryable(riskClass: RunbookRiskClass): boolean {
  return riskClass !== 'NON_IDEMPOTENT';
}
```

---

## 2. Agent Lease Lifecycle & Fencing

### 2.1 The Lease Token Protocol
1. When an Agent claims an attempt, the orchestrator issues a time-bounded lease (e.g. 60 seconds) with an exclusive `leaseToken`.
2. While executing, the Agent periodically issues lease renewals (`/api/runbook-agent/v1/renew`).
3. If the Agent loses network connectivity or crashes, the lease expires.
4. When the lease expires, the control plane fences the attempt:
   - If the Agent attempts to submit a result after lease expiry, the control plane rejects the submission with `LEASE_EXPIRED_OR_FENCED`.
   - The attempt is marked `TIMED_OUT` or moved to manual intervention.

### 2.2 Integration Test Verification
Verified in `tests/integration/runbook-execution-safety.test.ts`:
- Agent attempt claim fencing verified under concurrent worker contention.
- Replay attempts using an old lease token fail closed.
- Stale attempt submissions cannot overwrite updated execution state.

---

## 3. Offline Spooling & Durable Result Delivery

### 3.1 Local Filesystem Spool (`ResultSpool`)
In `agent/src/spool.ts`, the Agent runtime includes a crash-resilient disk spool:
- Once a command finishes on the host, the execution result (stdout, stderr, exit code, execution evidence) is written atomically to `data/spool/<attemptId>.json` before attempting HTTP upload to the control plane.
- If the control plane is unreachable, the Agent retains the result on disk.
- When network connectivity is reestablished, the Agent flushes pending results in FIFO order.
- Verified in `tests/integration/runbook-agent-runtime.test.ts` across simulated network dropouts and process crashes.

---

## 4. Dead-Letter Queues & Reconciler Resilience

### 4.1 Dead-Letter Queue Isolation
- Malformed attempt requests, tampered cryptographic envelopes, or attempts exceeding maximum retry limits are quarantined into the `RunbookAgentDeadLetter` database table.
- Quarantined attempts preserve full diagnostic headers and raw payloads for operator inspection without stalling active execution queues.

### 4.2 Control-Plane Reconciler
- The background reconciler (`src/lib/runbooks/reconciler.ts`) monitors executions in `RUNNING` or `WAITING_AGENT` states.
- If an execution exceeds its absolute deadline (`executionDeadlineAt`), the reconciler transitions the overall runbook to `TIMED_OUT`, preventing orphaned executions from running indefinitely.
