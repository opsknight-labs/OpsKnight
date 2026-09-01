---
order: 8
title: Internals
description: Source-aligned design notes for the OpsKnight v1.4 runtime and major subsystems
---

# Internals

OpsKnight v1.4 is a Next.js application backed by PostgreSQL. The web routes and internal scheduler run within the application deployment. PostgreSQL provides durable product state, job state, retry records, rate-limit counters, and scheduler coordination; Redis and a separate worker deployment are not required.

Start with these two guides:

- [Technical architecture](../core-concepts/technical-architecture) — deployment boundary, event processing, queues, consistency, availability, and failure modes.
- [Architecture diagrams](./diagrams) — runtime, event, scheduler, notification, and PWA flows.

## Subsystem guides

- [Circuit breakers](./circuit-breakers) — outbound failure isolation and state transitions.
- [Deduplication engine](./deduplication-engine) — event correlation and noise reduction.
- [Operational data flow and diagnostics](./enterprise-observability) — integration normalization, analytics, logging, and operational signals.
- [Dashboard](./dashboard) — dashboard rendering and interaction design.
- [System settings](./settings) — settings boundaries, roles, API keys, and secret handling.
- [Analytics surface matrix](./analytics-parity-audit) — desktop, mobile, executive, and export behavior.
- [Incident metric contract](./metric-contract) — canonical formulas, scopes, data states, drill-downs, and trend semantics.

## Important boundaries

- A successful incident transaction and an external notification delivery are separate outcomes.
- PostgreSQL-backed jobs survive application restarts; the bounded immediate notification queue is per process.
- Scheduler ownership is coordinated through PostgreSQL and requires at least one instance with internal cron enabled for maintenance work.
- Escalation and the recovery of committed responder pages do not depend on scheduler ownership; both run on every replica that runs the durable job worker, and both claim work with a compare-and-set so duplicates cannot deliver twice.
- Incident timeline events are not a substitute for a comprehensive immutable compliance ledger.
- The PWA caches selected data and queues selected actions; it is not a complete offline application.

Use the deployment, security, API, and troubleshooting sections for supported operator procedures. The files in this section explain implementation behavior and should not be read as availability or compliance guarantees.
