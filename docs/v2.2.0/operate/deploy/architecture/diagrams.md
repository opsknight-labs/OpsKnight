---
title: OpsKnight 2.0 architecture diagrams
description: Current integrated and split runtime, incident delivery, status projection, and PWA flows.
type: concept
product_area: deployment
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-10-02
  evidence: [src/lib/runtime-role.ts, src/lib/jobs/queue.ts, src/lib/event-outbox.ts, src/lib/status-page-delivery.ts, public/custom-sw.js]
---

# OpsKnight 2.0 architecture diagrams

These diagrams describe logical ownership. Deployment manifests, network policy,
database connection budgets, and immutable image digests remain the authoritative
installation inputs.

## Integrated topology

```mermaid
flowchart LR
  U[Users and integrations] --> E[Ingress / TLS]
  E --> I[Integrated OpsKnight process]
  I --> DB[(PostgreSQL)]
  I --> P[Email, SMS, voice, Push, Slack, Teams]
  I --> S[Public status page]
```

The integrated process serves Web traffic and owns the full scheduler plus all
worker lanes. It is the simplest topology but one process shares the HTTP,
scheduling, queue, delivery, and projection failure domain.

## Split topology

```mermaid
flowchart LR
  U[Users and integrations] --> E[Ingress / TLS]
  E --> W[Web replicas]
  W --> B[PgBouncer transaction pool]
  B --> DB[(PostgreSQL)]
  M[One-shot migration owner] --> DB
  SC[Scheduler] --> DB
  GW[General Worker] --> DB
  CW[Critical Worker] --> DB
  BW[Bulk Worker] --> DB
  SP[Status Projector] --> DB
  CW --> P[Paging providers]
  SP --> S[Public status page]
```

Only Web receives ingress. Migration uses a direct PostgreSQL connection. Every
role runs the same immutable image with a different `OPSKNIGHT_PROCESS_ROLE`.
Do not run integrated and split ownership against the same database.

## Incident event and delivery flows

```mermaid
sequenceDiagram
  participant Source as Alert source
  participant Web as Web/API
  participant DB as PostgreSQL
  participant Scheduler as Maintenance scheduler
  participant Critical as Critical worker
  participant General as General worker
  participant Bulk as Bulk worker
  participant Provider as Paging/ChatOps provider
  Source->>Web: Authenticated event
  Web->>DB: Classify, create/deduplicate incident, enqueue durable work
  Critical->>DB: Claim due escalation, recovery, and critical-notification work
  Scheduler->>DB: Run SLA checks, cleanup, reconciliation, and handoff maintenance
  General->>DB: Claim normal operational work
  Bulk->>DB: Claim public-incident, bulk-notification, and status fan-out work
  Critical->>Provider: Send latency-sensitive responder page/card
  Bulk->>Provider: Send bulk/public notification class
  Provider-->>Critical: Outcome/callback
  Provider-->>Bulk: Outcome/callback
  Critical->>DB: Persist attempt and outcome
  Bulk->>DB: Persist attempt and outcome
```

## Queue-lane ownership

```mermaid
flowchart TB
  Q[(PostgreSQL-backed durable jobs)] --> C[Critical lane: responder paging and latency-sensitive incident work]
  Q --> G[General lane: normal asynchronous work]
  Q --> B[Bulk lane: high-volume and lower-urgency work]
  Q --> R[Projector lane: public status projection]
```

Lane isolation protects critical work from bulk pressure; it does not remove
shared PostgreSQL or provider limits.

The Split maintenance scheduler does not execute escalations. The Critical
Worker owns escalation execution and recovery. The scheduler owns periodic SLA
breach checks, queue maintenance, cleanup/reconciliation, and shift/handoff
maintenance. In Integrated mode the single process owns both sets of work.

## Status projection and PWA flow

```mermaid
flowchart LR
  DB[(Incident and service state)] --> SP[Status Projector]
  SP --> PS[Projected public status state]
  PS --> Public[Public status page]
  DB --> CW[Critical Worker]
  CW --> Push[Web Push service]
  Push --> SW[Installed PWA service worker]
  SW --> Mobile[Mobile incident deep link]
  Mobile --> Outbox[Offline action outbox]
  Outbox --> Web[Authenticated Web/API]
  Web --> DB
```

Push requires a valid same-origin `/sw.js`, an effective Web Push provider, and
a per-device subscription. Offline actions remain authorization-bound when they
are replayed.

## Related pages

- [Integrated versus split runtime](./integrated-vs-split)
- [Runtime roles](./runtime-roles)
- [Database connections](./database-connections)
- [Mobile installation and Push](../../../guides/mobile/install-and-notifications)
