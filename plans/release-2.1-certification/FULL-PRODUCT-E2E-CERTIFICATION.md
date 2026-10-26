# OpsKnight 2.1 — Full Product End-to-End Certification (Journeys A–G)

**Candidate Commit SHA:** `abede9203d257fafeff8c4d19ef23dc269bc8274`  
**Execution Environment:** Distributed Production Topology (Nginx `:3900`, Web Replicas, Worker, PostgreSQL 16 on `:55490`)  
**Certification Date:** 2026-10-26  
**Auditor:** QA Architecture, SRE & Senior Staff Engineering

---

## 1. Journey Summary Matrix

| Journey Identifier | Operational Domain                                  | Total Test Cases | Pass   | Fail  | Blocked | Verdict       |
| ------------------ | --------------------------------------------------- | ---------------- | ------ | ----- | ------- | ------------- |
| **Journey A**      | Incident Ingestion, Deduplication & Lifecycle       | 9                | 9      | 0     | 0       | **PASS**      |
| **Journey B**      | Service Automation & Rule Engine                    | 4                | 4      | 0     | 0       | **PASS**      |
| **Journey C**      | On-Call Schedules, DST & Multi-Tier Escalations     | 7                | 7      | 0     | 0       | **PASS**      |
| **Journey D**      | Multi-Channel Notification Delivery & Durability    | 6                | 6      | 0     | 0       | **PASS**      |
| **Journey E**      | Runbook Authoring, Agent Plane & Approval Gates     | 5                | 5      | 0     | 0       | **PASS**      |
| **Journey F**      | Integrations, ChatOps & Status Platform             | 4                | 4      | 0     | 0       | **PASS**      |
| **Journey G**      | Operational Visibility, Health Center & Audit Trail | 5                | 5      | 0     | 0       | **PASS**      |
| **Overall**        | **End-to-End Operational Lifecycle**                | **40**           | **40** | **0** | **0**   | **100% PASS** |

---

## 2. Detailed Journey Assertions & Physical Evidence

### Journey A — Incident Ingestion & Lifecycle

- **Alert Ingestion:** Ingested standard Prometheus/Alertmanager webhook payload (`POST /api/v2/incidents`). Payload schema validated; mapped to Service Alpha (`cmvnog2vg0016w19dxe9b9x7y`).
- **Deduplication:** Repeated alert with identical deduplication key within 5-minute window updated existing incident rather than spawning a duplicate.
- **State Progression:** Verified progression through `OPEN` → `ACKNOWLEDGED` → `RESOLVED`.
- **Database & Timeline Parity:** `certify-ui-api-state-parity.ts` confirmed all 4 timeline entries mirrored between PostgreSQL and UI detail page.
- **Verdict:** **PASS**

### Journey B — Service Automation

- **Default State:** Verified that Service Automation features are safely disabled until explicitly configured.
- **Authoring & Validation:** Created rule with condition evaluation, parameter extraction, and first-match routing strategy.
- **Shadow Mode:** Tested simulation presets without mutating live incident fields. Shadow aggregate metrics recorded in `AutomationShadowAggregate`.
- **Concurrency & Revision:** Concurrency collision on rule edit rejected with HTTP `409 Conflict` (ETag mismatch guard).
- **Verdict:** **PASS**

### Journey C — On-Call & Escalation

- **Schedule Rotations:** Validated multi-layer weekly and daily rotations across UTC and regional daylight saving time transitions.
- **Dynamic Overrides:** Injected temporary 4-hour override; verified active on-call responder updated dynamically.
- **Multi-Level Escalation:** Level 1 timeout (15 min) successfully advanced alert to Level 2 responder pool when unacknowledged.
- **Acknowledgement Guard:** Acknowledgement by responder immediately halted pending escalation jobs.
- **Verdict:** **PASS**

### Journey D — Notification Delivery

- **Destination Routing:** Tested delivery dispatch across Email (Nodemailer), Webhook, Slack, and Microsoft Teams.
- **Delivery State Tracking:** Persisted delivery lifecycle in `NotificationDeliveryAttempt` (`QUEUED` → `SENDING` → `DELIVERED`).
- **Worker Recovery & Deduplication:** Terminated worker mid-flight during delivery queue drain. On restart, worker leased pending attempts without duplicate dispatch to external endpoints.
- **Verdict:** **PASS**

### Journey E — Runbook Engine

- **Lifecycle Editing & Publishing:** Draft v1 created, step definitions validated (`POST /runbooks/{id}/drafts/{draftId}/validate`), and published as immutable revision 1.
- **Execution Preview:** Evaluated parameter substitution and agent capability matching without triggering remote side-effects (`POST /runbooks/{id}/executions/preview` returned HTTP 200).
- **Detached-Rule UI Assertion Fix:** PR #916 resolved the UI copy divergence on detached rules across Chrome, Firefox, and WebKit.
- **Scope Boundary:** Evaluated strictly against documented 2.1 scope (Human-approved and scheduled executions; unattended full remediation documented as manual-approval gated).
- **Verdict:** **PASS**

### Journey F — Integrations & Status Platform

- **Public Status Updates:** Created announcement on public status page; verified immediate rendering on unauthenticated view (`/status/[slug]`).
- **Subscriber Fanout:** Added test email subscriber; verified notification generation upon status publication.
- **Privacy Hardening:** Public status page endpoints strictly isolated from authenticated backend administrative models.
- **Verdict:** **PASS**

### Journey G — Operational Visibility & Audit Trail

- **Health Center:** System Health Center dashboard correctly aggregated database connection pool latency, queue backlog, and worker heartbeat.
- **Cryptographic Audit Export:** Background worker executed export job, encrypted payload with `ENCRYPTION_KEY`, and streamed download with verified SHA-256 integrity.
- **SLA Tracking:** Ack and resolve target timers recorded in `IncidentSlaPolicy` agreed with incident timeline timestamps.
- **Verdict:** **PASS**
