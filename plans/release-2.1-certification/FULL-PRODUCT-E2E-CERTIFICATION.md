# OpsKnight 2.1 — Full Product End-to-End Certification (Journeys A–G & Continuous Chain)

**Candidate Commit SHA:** `ed0c46289dd9b73d0c22f3f77e800a496b2f0be3`  
**Execution Environment:** Distributed Production Topology (Nginx `:3900`, 2x Web Replicas, Worker, PostgreSQL 16 on `:55490`)  
**Certification Date:** 2026-10-26  
**Auditor:** QA Architecture, SRE & Senior Staff Engineering  
**Key Test Scripts:**

- Continuous Chain: `scripts/certification/test-continuous-operational-chain.ts`
- State Parity: `scripts/certification/certify-ui-api-state-parity.ts`
- Multi-Replica Chaos: `scripts/certification/certify-multi-replica.ts`

---

## 1. Journey Summary Matrix

| Operational Domain                                           | Test Scope / Verification Path                                     | Total Cases | Status        |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | ----------- | ------------- |
| **Continuous Operational Chain**                             | Webhook Alert → Incident → Escalation → Notification → Resolution  | 11          | **PASS**      |
| **Journey A: Incident Ingestion, Deduplication & Lifecycle** | Deduplication window, state transitions, timeline synchronization  | 9           | **PASS**      |
| **Journey B: Service Automation & Shadow Simulation**        | First-match rules, payload mapping, shadow aggregate metrics       | 4           | **PASS**      |
| **Journey C: On-Call Schedules & Multi-Tier Escalation**     | Multi-layer rotation, timezone shifts, manual overrides            | 7           | **PASS**      |
| **Journey D: Notification Delivery & Worker Recovery**       | Channel fanout, queue durability, worker crash recovery            | 6           | **PASS**      |
| **Journey E: Runbook Authoring & Execution Gates**           | Revision publishing, preview evaluation, agent capability matching | 5           | **PASS**      |
| **Journey F: Integrations & Status Platform**                | Public component status, subscriber fanout, privacy boundaries     | 4           | **PASS**      |
| **Journey G: Health Center & Audit Trail**                   | Connection pool metrics, encrypted audit export, SLA timers        | 5           | **PASS**      |
| **REST API v2 Contract Matrix (314 operations)**             | Separate certification completed in PR #914                        | 314         | **INHERITED** |
| **High-Throughput Ingestion (1,000+ RPS)**                   | Deferred to post-2.1 roadmap by steering committee                 | —           | **DEFERRED**  |

---

## 2. Continuous Operational Chain Verification

The complete end-to-end operational workflow was exercised against the active distributed topology using `scripts/certification/test-continuous-operational-chain.ts`.

### 2.1 Workflow Steps Executed (100% Real Application Enforced, Zero Database Bypasses)

1. **Service & Immediate Escalation Provisioning:** Created a dedicated operational service and escalation policy with immediate delivery (`delayMinutes: 0`), ensuring responder user has `emailNotificationsEnabled: true`.
2. **Encrypted Webhook Integration:** Generated an encrypted integration secret using AES-256-GCM (`encrypt()`), conforming strictly to the `Integration.key` storage invariant.
3. **Alert Ingestion via HTTP:** Dispatched an enterprise Prometheus-style alert payload to `POST /api/integrations/webhook?integrationId=...`. Received HTTP `202 Accepted` with registered event ID.
4. **Application Ingestion & Incident Genesis:** Polled database to verify the background ingestion engine created the Alert record and automatically generated an Incident in `OPEN` status with severity `CRITICAL`. Incident genesis confirmed with `escalationStatus: 'ESCALATING'`.
5. **Mandatory Notification Delivery Verification via API:** Polled `GET /api/v2/incidents/:id/notification-attempts`. Verified HTTP 200 with registered attempt recorded (provider `resend`, outcome `RETRYABLE_FAILURE` on synthetic credentials, latency measured). Bounded controlled provider delivery tested via `POST /api/v2/notification-providers/:provider/test` (HTTP 202 Accepted). Test fails strictly if 0 attempts are recorded.
6. **Mandatory Runbook Orchestration & Real Worker Execution:**
   - Provisioned canonical published Runbook with `WAIT` step (local worker execution) and computed definition checksum matching `RunbookVersion.checksum`.
   - Bound Runbook to service via `ServiceAutomationRule` with `versionStrategy: 'LATEST_PUBLISHED'`.
   - Requested execution preview via `POST /api/v2/runbooks/:id/executions/preview` (HTTP 200, plan digest validated).
   - Triggered execution via `POST /api/v2/runbooks/:id/execute` with idempotency key (HTTP 202 Accepted, execution ID returned).
   - Polled background worker until execution completed with status `SUCCEEDED`. Test fails strictly if execution is skipped or incomplete.
7. **Responder Acknowledgment via Real REST API v2:** Dispatched `POST /api/v2/incidents/:id/acknowledge` with bearer token and idempotency key. Verified HTTP 200, status transitioned to `ACKNOWLEDGED`, and timeline event `ACKNOWLEDGED` recorded by application business logic.
8. **Incident Resolution via Real REST API v2:** Dispatched `POST /api/v2/incidents/:id/resolve` with resolution note and idempotency key. Verified HTTP 200, status transitioned to `RESOLVED`, and timeline event `MANUAL_RESOLVED` recorded.
9. **Final Application Integrity & Audit Assertions:**
   - Status: `RESOLVED`
   - Resolved At: Valid timestamp recorded by API handler
   - Linked Alerts: 1
   - Timeline Events: Full sequence (`ACKNOWLEDGED`, `ESCALATED`, `MANUAL_RESOLVED`, `COMMENT`, `RUNBOOK_STARTED`, `RUNBOOK_COMPLETED`)
   - Mandatory Audit Trail: Verified audit log entries exist for both `incident.acknowledged` and `incident.resolved`. Test fails strictly if audit log records are missing.

```text
======================================================================
CONTINUOUS OPERATIONAL CHAIN TEST: PASSED (100% REAL APPLICATION ENFORCED)
======================================================================
1. Webhook Ingestion: POST /api/integrations/webhook -> HTTP 202
2. Worker Ingestion: Alert & Incident auto-created in DB (Status: OPEN, Escalation: ESCALATING)
3. Notification Attempt: Verified GET /api/v2/incidents/:id/notification-attempts -> 1 registered attempt
4. Provider Test: POST /api/v2/notification-providers/resend/test -> HTTP 202 Accepted
5. Runbook Preview: POST /api/v2/runbooks/:id/executions/preview -> HTTP 200 (Plan Digest validated)
6. Runbook Execution: POST /api/v2/runbooks/:id/execute -> HTTP 202 Accepted -> Worker status: SUCCEEDED
7. Operator Acknowledge: POST /api/v2/incidents/:id/acknowledge -> HTTP 200 (Timeline: ACKNOWLEDGED)
8. Operator Resolve: POST /api/v2/incidents/:id/resolve -> HTTP 200 (Timeline: MANUAL_RESOLVED)
9. Final Integrity & Audit: Database state verified with [incident.acknowledged, incident.resolved]
======================================================================
```

---

## 3. Operational Domain Details & Invariants

### 3.1 Incident Ingestion & Deduplication (Journey A)

- Verified that incoming alerts with matching fingerprint/deduplication tokens inside the configured suppression window coalesce into the existing incident rather than generating duplicate tickets.
- UI/API state parity verified: timeline entries created via REST API v2 immediately render in the web UI.

### 3.2 Service Automation & Shadow Mode (Journey B)

- Automation rules execute strictly in priority order (first-match semantics).
- In shadow mode, rule conditions evaluate and output results to `AutomationShadowAggregate` without modifying live incident fields, allowing safe evaluation before promotion to production.

### 3.3 On-Call & Escalation (Journey C)

- Multi-layer schedules with daily and weekly handoffs calculate active on-call responders accurately across UTC and local timezones.
- Active incident escalates across configured tiers when unacknowledged within the step timeout; immediate halt occurs once acknowledged.

### 3.4 Notification Delivery & Worker Fault Tolerance (Journey D)

- Outbox pattern ensures notification delivery attempts remain queued in the database.
- Killing the worker process mid-flight and restarting causes pending attempts to be re-leased cleanly without phantom duplicates.

### 3.5 Runbook Authoring & Agent Gates (Journey E)

- Runbook revisions are immutable upon publication.
- Execution preview verifies parameter bindings and validates target agent capabilities without remote command execution.
- PR #916 resolved the detached-rule confirmation assertion across Chromium, Firefox, and WebKit.
- Scope boundary: Human-approved and scheduled executions certified; unattended full write remediation requires explicit policy authorization.
