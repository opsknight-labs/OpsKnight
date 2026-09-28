# OpsKnight Load & Scalability Certification Suite

This directory contains the formal, repository-level **OpsKnight Load-Certification Suite**. It executes an identical, realistic incident-response workload across every supported OpsKnight deployment topology (**Docker Compose**, **Docker Swarm**, **Kind Kubernetes + Helm**, and **Kind Kubernetes + Kustomize**) with programmable downstream provider emulators, unified Prometheus/PostgreSQL telemetry, and deterministic correctness invariant verification.

---

## 1. Architecture & Directory Layout

```text
tests/load/
├── scenarios/
│   ├── _shared.js                # Load levels (L0-L9), duration profiles, k6 metrics, manifest loader
│   ├── alert-ingestion.js        # Contract mode (120 req/min guard) + Capacity mode (multi-key, dedup storm, flapping)
│   ├── incident-lifecycle.js     # Create, ACK, resolve, snooze, idempotency replay, concurrent responder races
│   ├── escalation.js             # Multi-step USER/SCHEDULE/TEAM escalations + ACK vs escalation worker races
│   ├── notifications.js          # Multi-channel dispatch under progressive provider latency/429/503 faults
│   ├── status-fanout.js          # Public status page reads + BULK subscriber fanout vs CRITICAL priority guard
│   ├── realtime.js               # Concurrent SSE streams (/api/realtime/stream & /api/events/stream)
│   ├── mixed-incident-storm.js   # Full major-outage storm combining all subsystems simultaneously
│   └── recovery.js               # Continuous ingestion & API probes during worker/scheduler/PgBouncer kills
├── fixtures/
│   ├── users/index.ts            # Scale profiles (small, medium, large, storm), teams, users, push endpoints
│   ├── services/index.ts         # 1 Contract integration bucket + N Capacity integration buckets
│   ├── schedules/index.ts        # Multi-layer on-call schedules with active overrides
│   ├── escalation-policies/index.ts # 4-step escalation policies across USER -> SCHEDULE -> TEAM
│   ├── incidents/index.ts        # Baseline OPEN/ACKNOWLEDGED/RESOLVED incidents
│   └── notification-providers/index.ts # Emulator endpoints, deterministic VAPID keys, status page fixture
├── providers/
│   ├── shared.ts                 # Programmable state machine (200_fast, 200_slow, 429, 503, timeout, drop, duplicates)
│   ├── server.ts                 # Unified HTTP (:8086), SMTP (:2525), and Control/Telemetry API (:8088)
│   ├── email/index.ts            # SMTP (:2525) + HTTP Email API emulator
│   ├── slack/index.ts            # Slack Incoming Webhook + Web API (chat.postMessage, conversations.create)
│   ├── sms/index.ts              # Twilio Messages API emulator
│   ├── push/index.ts             # RFC 8030 Web Push endpoint emulator
│   ├── teams/index.ts            # Microsoft Teams OAuth2 + Bot Framework Connector emulator
│   └── webhook/index.ts          # Generic Incident & Status-Page Webhook receiver
├── helpers/
│   ├── seed.ts                   # Bulk Prisma seeder + JWE session cookie generator -> seed-manifest.json
│   ├── cleanup.ts                # Removes lt-* entities in FK-safe order and resets provider emulators
│   ├── metrics.ts                # Scrapes /api/metrics, pg_stat_activity, pg_locks, queues, and container stats
│   ├── verify-results.ts         # Deterministic correctness verifier (5 zero-tolerance invariants)
│   └── topology.ts               # Sequential Phase 1-6 topology orchestrator & Markdown report generator
└── README.md
```

---

## 2. Two-Tier Alert Ingestion Design

OpsKnight's `/api/events` endpoint enforces a rate limit of **120 requests per 60 seconds per integration key**. To test both rate-limit correctness and true database/worker saturation without disabling production rate limiting:

1. **Contract Mode (`lt_contract_events_key_0001`)**: Sends >120 req/min against a single integration key and verifies that `HTTP 429` responses include a valid `Retry-After` header while `<= 120` requests per minute return `HTTP 202`.
2. **Capacity Mode (`lt_capacity_events_key_0002` … `N`)**: Shards traffic across 40–300+ seeded integration keys (`<= 1.5 req/s` per key) so `150`–`1,000+ req/s` reach PostgreSQL `ReadCommitted` transactions, `pg_advisory_xact_lock` deduplication locks, and the durable `BackgroundJob` outbox.

---

## 3. Load Levels (`L0`–`L9`) & Scale Profiles

| Load Level | Name | Target VUs | Target RPS | SSE Streams | Purpose |
| :--- | :--- | :---: | :---: | :---: | :--- |
| **`L0`** | `L0_smoke` | 8 | 15 | 10 | Fast smoke correctness check |
| **`L1`** | `L1_steady_baseline` | 25 | 50 | 100 | Steady baseline throughput & latency |
| **`L2`** | `L2_normal_production_peak` | 100 | 150 | 250 | Normal enterprise peak workload |
| **`L3`** | `L3_alert_storm` | 250 | 500 | 500 | Multi-service alert storm |
| **`L4`** | `L4_dedup_storm` | 250 | 500 | 250 | Hot dedup-key advisory lock contention |
| **`L5`** | `L5_major_outage_fanout` | 300 | 300 | 500 | Major outage + 50k+ notification fanout |
| **`L6`** | `L6_provider_degradation` | 150 | 150 | 250 | Downstream 429 / 503 / timeout headwinds |
| **`L7`** | `L7_realtime_sse_scale` | 500–5000 | 100 | 1500–5000 | Concurrent SSE fanout scale |
| **`L8`** | `L8_Chaos_Recovery` | 150 | 150 | 200 | Worker / scheduler / PgBouncer kill recovery |
| **`L9`** | `L9_breaking_point_ramp` | 500–1000 | 1000 | 1000 | Breaking-point step ramp |

### Scale Profiles (`--scale=<small|medium|large|storm>`)
- `small`: 8 teams, 50 users, 16 services, 500 status-page subscribers, 200 baseline incidents.
- `medium`: 24 teams, 250 users, 60 services, 2,500 status-page subscribers, 1,000 baseline incidents.
- `large`: 50 teams, 1,000 users, 150 services, 10,000 status-page subscribers, 5,000 baseline incidents.
- `storm`: 100 teams, 2,500 users, 320 services, 25,000 status-page subscribers, 10,000 baseline incidents.

---

## 4. Correctness Invariants Certified After Every Run

`npm run load:verify` (`tests/load/helpers/verify-results.ts`) queries PostgreSQL and the provider emulator telemetry to assert 5 strict invariants:

1. **Zero Duplicate Open Incidents (`duplicates = 0`)**: No two `OPEN` or `ACKNOWLEDGED` incidents share `(serviceId, dedupKey)`.
2. **Zero Lost Accepted Alerts (`lost = 0`)**: Every `Alert` persisted on `lt-*` services is linked to a valid `Incident`.
3. **Zero False Escalations (`false_escalation = 0`)**: No `ESCALATED` event occurs after `acknowledgedAt` or `resolvedAt` (with a 2s clock/commit window tolerance).
4. **Zero Corrupted Lifecycle States (`corrupted_state = 0`)**: Every `ACKNOWLEDGED` incident has `acknowledgedAt`, every `RESOLVED` incident has `resolvedAt`, and every `SNOOZED` incident has `snoozedUntil`.
5. **Zero Critical Notification Starvation (`critical_starved = 0`)**: Under heavy `BULK` status-page fanout, `CRITICAL` notifications are never starved beyond the SLA threshold.

---

## 5. Quickstart Commands

### Inspect the Sequential 6-Phase Certification Plan (Dry Run)
```bash
npm run load:certify -- --dry-run
```

### Start the Programmable Provider Emulator Suite Standalone
```bash
npm run load:providers
# HTTP Providers: :8086 | SMTP: :2525 | Control & Telemetry API: :8088
```

### Seed Deterministic Load-Test Data
```bash
npm run load:seed -- --scale=small --base-url=http://127.0.0.1:3000
```

### Run an Individual k6 Scenario
```bash
k6 run -e BASE_URL=http://127.0.0.1:3000 -e LOAD_LEVEL=L1 -e LOAD_DURATION_PROFILE=fast tests/load/scenarios/alert-ingestion.js
```

### Verify Post-Run Correctness Invariants & Clean Up
```bash
npm run load:verify
npm run load:cleanup
```

### Execute Sequential Certification for a Specific Phase or Topology
```bash
# Phase 1: Docker Compose Matrix (Integrated, Split, Split + PgBouncer)
npm run load:certify -- --phase=1 --scale=medium --duration=fast

# Phase 3: Docker Swarm Matrix (Single-Node Split, HA Split + Role Kills)
npm run load:certify -- --phase=3 --scale=medium --duration=fast

# Phase 4: 4-Node Kind Kubernetes (helm-test followed by kustomize-test)
npm run load:certify -- --phase=4 --scale=medium --duration=fast
```
