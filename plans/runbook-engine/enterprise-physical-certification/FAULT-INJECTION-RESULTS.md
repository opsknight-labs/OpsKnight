# OpsKnight Runbook Engine — Fault Injection & Reliability Results

## 1. Scope & Fault Scenarios

Distributed systems must handle node crashes, worker termination, network partitions, and database disconnects without creating duplicate physical mutations or phantom successes.

---

## 2. Certified Fault Injection Scenarios

| Test Scenario | Fault Injected                                | Observed System Behavior                                               | Preserved Outcome          |  Status  |
| ------------- | --------------------------------------------- | ---------------------------------------------------------------------- | -------------------------- | :------: |
| **FI-001**    | Agent killed before claiming job              | Job remains queued in `PENDING` state; picked up by surviving agent    | `SUCCEEDED` (via Failover) | **PASS** |
| **FI-002**    | Agent killed immediately after claim          | Worker lease expiry triggers lease reclamation; re-queues attempt      | `SUCCEEDED` (Reassigned)   | **PASS** |
| **FI-003**    | Agent killed during mutation step             | Execution marked `UNKNOWN`; operator reconciliation requested          | No blind retry; `UNKNOWN`  | **PASS** |
| **FI-004**    | Agent killed post-mutation before report      | State preserved; duplicate write prevented; target state verified      | Target verified `healthy`  | **PASS** |
| **FI-005**    | Network partition between Agent and OpsKnight | Agent enters reconnect backoff; resumes polling upon recovery          | Reconnected cleanly        | **PASS** |
| **FI-006**    | Runbook Worker process crashed & restarted    | Outbox processor resumes pending background jobs; zero lost events     | Zero lost events           | **PASS** |
| **FI-007**    | PostgreSQL connection pool saturated          | Queries queue gracefully; transactions abort safely without corruption | Data integrity preserved   | **PASS** |
| **FI-008**    | Step execution timeout expired                | Agent terminates child process (`SIGKILL` after grace period)          | Step marked `TIMED_OUT`    | **PASS** |
| **FI-009**    | Execution cancelled at approval gate          | Runbook transitions immediately to `CANCELLED`; no mutation executed   | `CANCELLED`                | **PASS** |
| **FI-010**    | External health check verification fails      | Mutation completed but postcheck fails; execution fails safely         | Marked `FAILED`            | **PASS** |

---

## 3. Durability Guarantees

1. **Transactional Outbox Pattern**: Ingestion side-effects are committed in the same database transaction as incident creation, ensuring zero lost triggers.
2. **Advisory Lock Fencing**: Prevents concurrent claim races across multiple polling workers or agents.
3. **Lease Expiration Reclamation**: Stale claims from disconnected agents are automatically re-queued after 60 seconds without risk of duplicate execution.
