---
title: Health monitoring and circuit breaker
description: Monitor fleet health, remediation budgets, circuit breaker thresholds, Prometheus alerts, and worker evidence.
type: how-to
product_area: runbooks
audience: [administrator, operator]
verification:
  level: source
  verified_at: 2026-10-15
  evidence:
    [
      src/app/(app)/runbooks/health/page.tsx,
      src/lib/runbooks/reconciler.ts,
      monitoring/prometheus/opsknight-alerts.yaml,
    ]
---

# Health monitoring and circuit breaker

**Runbooks → Health** provides a single dashboard for Runbook system health
including fleet status, queue age, artifact storage, unknown outcomes, expired
leases, circuit-breaker indicators, and Agents requiring attention.

## Health summary

The health dashboard reports:

| Metric                | Description                                            |
| --------------------- | ------------------------------------------------------ |
| **Overall health**    | `HEALTHY`, `DEGRADED`, or `UNKNOWN`                    |
| **Enrolled Agents**   | Total, online, offline, degraded, enrolling, unhealthy |
| **Spool depth**       | Pending result uploads queued locally on Agents        |
| **Dead letter depth** | Permanently failed/poisoned jobs                       |
| **Oldest pending**    | Age of oldest pending attempt in seconds               |
| **Unknown outcomes**  | Count of UNKNOWN outcome steps                         |
| **Expired leases**    | Step attempts with expired leases                      |
| **Circuit breakers**  | Services at circuit-breaker threshold                  |

## Health issue types

The health page surfaces these specific issue categories:

| Issue ID             | Category | Trigger condition                                    |
| -------------------- | -------- | ---------------------------------------------------- |
| `worker-evidence`    | Queue    | Worker status not HEALTHY or redundancy UNCONFIGURED |
| `offline-agents`     | Agent    | Any Agents offline (>90s no heartbeat)               |
| `degraded-agents`    | Agent    | Agents in DEGRADED state                             |
| `enrolling-agents`   | Agent    | Enrollment tokens issued but not completed           |
| `unhealthy-agents`   | Agent    | Agents with errors or dead-letter backlog            |
| `circuits`           | Circuit  | Services at circuit-breaker threshold                |
| `unknown-outcomes`   | Unknown  | UNKNOWN step/attempt outcomes                        |
| `expired-leases`     | Lease    | Active step leases past deadline                     |
| `stale-queue`        | Queue    | Oldest pending attempt >300s (5 min)                 |
| `local-worker-error` | Queue    | In-process Runbook worker fault                      |

## Per-Agent health metrics

Each Agent reports:

| Metric               | Description                           | Threshold                                |
| -------------------- | ------------------------------------- | ---------------------------------------- |
| `lastHeartbeatAt`    | Time of last heartbeat                | >90s → OFFLINE                           |
| `spoolDepth`         | Pending result uploads queued locally | High values indicate connectivity issues |
| `deadLetterDepth`    | Permanently failed/poisoned jobs      | Non-zero requires investigation          |
| `activeAttemptCount` | Currently claimed steps               |                                          |
| `lastError`          | Last reported runtime error           | Non-empty requires investigation         |
| `policyHash`         | Hash of last policy push              | Changes after policy file update         |

## Circuit breaker

The circuit breaker protects against runaway automation:

| Parameter             | Value                                                        |
| --------------------- | ------------------------------------------------------------ |
| **Failure threshold** | 3 failures within 15 minutes                                 |
| **Scope**             | Per service                                                  |
| **Effect**            | Automatic executions halt; transitions to `WAITING_APPROVAL` |
| **Recovery**          | Requires human intervention to resume                        |

When the circuit breaker trips, automatic rules stop dispatching. Pending
executions transition to `WAITING_APPROVAL`, requiring explicit responder
approval to continue.

## Remediation budgets

Administrators configure per-incident limits under **Runbooks → Agents →
Automatic remediation budgets**:

| Budget                              | Default | Maximum | Description                                            |
| ----------------------------------- | ------- | ------- | ------------------------------------------------------ |
| Auto executions per incident        | 3       | 100     | Total automatic workflow starts                        |
| State writes per incident           | 3       | 100     | Automatic write actions                                |
| Non-idempotent actions per incident | 0       | 100     | Automatic non-idempotent actions (disabled by default) |

Key behaviors:

- Automatic execution reserves the entire authored plan **transactionally**
  under an incident lock.
- Failed or canceled attempts **do not refund** the conservative budget.
- Exhaustion produces a frozen suggestion requiring responder action instead
  of silently dropping remediation.
- Explicit responder executions require normal risk approvals and local
  policy but **do not consume** automatic budgets.
- Incident Runbooks tab shows current usage.

## Artifact retention

Administrators set **Execution artifact retention** in **Runbooks → Agents →
Security**:

| Setting          | Range       | Default                                                |
| ---------------- | ----------- | ------------------------------------------------------ |
| Retention period | 1–3650 days | `RUNBOOK_ARTIFACT_RETENTION_DAYS` env var (default 30) |

- Requires `admin.manage` capability to change.
- Background maintenance permanently removes expired artifact **contents** in
  bounded batches.
- Execution records remain; deleted output cannot be restored.
- Destructive confirmation required in the UI.
- Export evidence before shortening the policy.

## Worker health

Worker health uses **durable PostgreSQL evidence** from worker instances and
lanes, not the web process's local scheduler state:

| State      | Meaning                                                        |
| ---------- | -------------------------------------------------------------- |
| `HEALTHY`  | Fresh successful dispatch and reconciliation within 90 seconds |
| `DEGRADED` | Worker present but reporting faults                            |
| `UNKNOWN`  | Missing or incomplete evidence, even when queue is empty       |

In split deployments, inspect the Runbook Worker readiness and logs separately.
The web process's local scheduler state alone cannot establish fleet health.

## Prometheus alerting

The bundled Prometheus rules include alerts for nonce and artifact maintenance:

### Stalled maintenance

No successful batch in the last 5 minutes (nonces) or 10 minutes (artifacts)
while execution workers report healthy.

### Lagging maintenance

Oldest expired data exceeds 5 minutes (nonces) or 1 hour (artifacts),
sustained for 5 minutes.

### Failing maintenance

At least 3 failed transactions over 10 minutes, sustained for 2 minutes.

### Key metrics to monitor

| Metric                                                              | Purpose                       |
| ------------------------------------------------------------------- | ----------------------------- |
| `opsknight_runbook_nonce_purge_rows_total`                          | Nonce purge throughput        |
| `opsknight_runbook_nonce_purge_batches_total{result="failed"}`      | Failed purge batches          |
| `opsknight_runbook_nonce_purge_duration_seconds`                    | Purge batch duration          |
| `opsknight_runbook_nonce_purge_oldest_expired_age_seconds`          | Oldest expired nonce age      |
| `opsknight_runbook_artifact_purge_oldest_expired_age_seconds`       | Oldest expired artifact age   |
| `opsknight_runbook_claim_availability_probes_total{result="empty"}` | Coalesced availability probes |

Scrape each scheduler process's authenticated `/api/metrics` endpoint as well
as the web endpoint. Maintenance counters and age observations are
process-local. Load alert rules per OpsKnight deployment without combining
unrelated deployments.

## See also

- [Troubleshooting](../../troubleshooting/runbooks/) for diagnosing specific
  issues.
- [Enterprise qualification](../../operate/deploy/runbook-qualification) for
  load testing and fault receipts.
- [Agent operations](../../operate/deploy/agent-operations) for deployment
  topologies.
