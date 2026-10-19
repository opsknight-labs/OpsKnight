# OpsKnight Runbook Engine — Phase 10: Concurrency, Load & Scale Architecture

## 1. Concurrency Architecture & Queue Mechanics

OpsKnight's execution subsystem is architected for horizontally scalable, concurrent execution across distributed infrastructure:

- **Queue Isolation & Dispatch**: The execution queue relies on PostgreSQL row-level locks (`SELECT ... FOR UPDATE SKIP LOCKED`) to ensure competing workers never claim the same queued item simultaneously.
- **Physical Side-Effect Boundaries**: While queue locking and lease fencing prevent duplicate dispatch, they cannot guarantee exactly-once physical side effects if an agent crashes mid-command. Non-idempotent steps require target-level idempotency or explicit compensation steps, and are strictly fenced from automatic retry after UNKNOWN outcomes (`types.ts:137`).
- **Lease Fencing**: Workers acquire a time-bounded lease (`leaseExpiresAt`). Expired leases are reclaimed by reconciler routines without dropping queued tasks.
- **Service Isolation**: Concurrently running executions for different services operate in separate transactions and tenant contexts.
- **Agent Workload Concurrency**: Agents support bounded concurrent task execution limits, rejecting tasks with backpressure when capacity is exceeded.

---

## 2. Scale Boundaries & Domain Constants

All scale limits are explicitly governed by canonical domain constants:

| Limit / Metric                      | Source Location                           | Value                                            | Enforcement Mechanism                          |
| ----------------------------------- | ----------------------------------------- | ------------------------------------------------ | ---------------------------------------------- |
| **Max Steps per Runbook**           | `src/lib/runbooks/types.ts:347`           | `50` steps (`MAX_RUNBOOK_STEPS`)                 | Zod schema validation during draft save        |
| **Max Flattened Policy Actions**    | `src/lib/runbooks/policy-checks.ts:60`    | `200` actions                                    | Checked during policy request evaluation       |
| **Max Automatic Policy Targets**    | `src/lib/runbooks/agent-deployment.ts:56` | `100` targets (`MAX_AUTOMATIC_POLICY_TARGETS`)   | Query limit & policy check target ceiling      |
| **Policy Certification Batch Size** | `src/lib/runbooks/agent-deployment.ts:57` | `25` targets (`POLICY_CERTIFICATION_BATCH_SIZE`) | Chunked database inserts                       |
| **Agent Heartbeat TTL**             | `src/lib/runbooks/agent-api.ts`           | `90` seconds                                     | Agents without contact for >90s marked OFFLINE |
| **Agent Enrollment Expiry**         | `src/lib/runbooks/agent-auth.ts:61`       | `15` minutes                                     | Ephemeral token expiry deadline                |

---

## 3. Concurrency Evaluation & Evidence Level

| Scenario                          | Architectural Mechanism                                      | Verification Scope                                                      | Status                        |
| --------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- | ----------------------------- |
| **Parallel Alert Ingestion**      | Prometheus webhook endpoint (`/api/integrations/prometheus`) | Deduplication by fingerprint; distinct alerts create separate incidents | **FUNCTIONAL PASS**           |
| **Worker Queue Lock Isolation**   | PostgreSQL `SELECT ... FOR UPDATE SKIP LOCKED`               | Verified through queue integration tests (`queue.test.ts`)              | **INTEGRATION PASS**          |
| **Worker Lease Reclaim**          | Reconciler checks `leaseExpiresAt < now`                     | Stale leases re-queued; non-idempotent steps fenced                     | **CODE GUARD**                |
| **Policy Batching**               | `POLICY_CERTIFICATION_BATCH_SIZE = 25` chunks                | Atomically inserted across targets in transactions                      | **FUNCTIONAL PASS**           |
| **High-Volume Load Benchmarking** | Fleet-wide sustained throughput under heavy load             | Dedicated load generation with Prometheus metrics                       | **RECOMMENDED FOR PERF TEST** |
