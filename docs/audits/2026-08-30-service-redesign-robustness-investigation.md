# Core robustness and centralization investigation

Date: 2026-08-30

Scope: incident lifecycle, assignment and metadata mutation paths, durable side effects, background jobs, cron ownership, and metric rollups. This was a manual logic and failure-mode review, not an automated Bugbot-only pass.

## Findings and remediation

### CR-01 — Outbox jobs could report success after delivery failed

Notification, webhook, Slack, and status-page helpers frequently returned a failed result that the outbox worker ignored. The worker then marked the job completed, permanently losing the delivery.

Remediation: delivery helpers now expose aggregate failure results and event-side-effect handlers throw on actionable failures, allowing the existing job retry policy to run. Expected configuration skips remain non-failures.

### HI-01 — Reopened or unacknowledged incidents retained stale acknowledgement time

Both transitions returned the incident to `OPEN` without clearing `acknowledgedAt`. Consumers that use the timestamp independently of status could treat the incident as acknowledged.

Remediation: both lifecycle commands clear `acknowledgedAt`, with regression coverage.

### HI-02 — Long-running live jobs could be reclaimed after ten minutes

Job claiming treated an old `startedAt` as an abandoned worker lease, but active workers never renewed it. A healthy slow delivery could therefore execute concurrently on two workers.

Remediation: processing jobs renew `startedAt` every minute and stop the heartbeat in `finally`. This prevents routine live-job reclamation; delivery APIs still need their own idempotency for crash-boundary duplicate protection.

### HI-03 — Assignment exclusivity was only a caller convention

Some mutation paths set `assigneeId` without clearing `teamId`, allowing contradictory ownership. The schema comment claimed exclusivity but the database did not enforce it.

Remediation: REST, bulk, and interactive reassignment paths clear the opposite owner. A migration repairs legacy dual assignments and adds a database check constraint.

### HI-04 — Rollup reconciliation could permanently skip changed incidents

The scheduler selected the first 5,000 changed incident rows and then advanced the refresh watermark. If more than 5,000 rows shared the window, later rows could be starved or skipped.

Remediation: reconciliation selects distinct affected UTC days directly in PostgreSQL. Cost is bounded by retention days rather than incident-row count, so the watermark advances only after every affected day is regenerated.

### ME-01 — Scheduler shutdown could release leadership while work was active

Shutdown cleared the timer and released the distributed lock without waiting for the current cron run. Another replica could acquire the lock while the first process was still mutating shared state.

Remediation: the scheduler tracks its active run, disables rescheduling, drains that promise, and only then releases the lock.

### ME-02 — Metadata side effects were decentralized and partly non-atomic

REST and bulk reassignment delivered notifications and webhooks after commit with best-effort error handling. Bulk urgency wrote incident state and timeline events in separate transactions. Watcher deletion trusted a watcher ID without proving it belonged to the incident in the request.

Remediation: metadata/reassignment delivery is persisted through the shared durable outbox in the mutation transaction; bulk urgency state and timeline writes are atomic; watcher removal scopes deletion to both IDs. Explicitly assigned team members are now resolved by the centralized notification strategy rather than by route-specific loops.

## Residual risk

The outbox provides at-least-once processing, not exactly-once external delivery. A worker crash after a provider accepts a message but before job completion can still duplicate delivery. Provider idempotency keys or a delivery-attempt ledger should be the next hardening layer.
