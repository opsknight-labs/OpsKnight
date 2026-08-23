---
order: 6
title: Architecture diagrams
description: Source-aligned runtime, event, scheduler, notification, and mobile flows for OpsKnight v1.3
---

# Architecture diagrams

These diagrams show the v1.3 implementation boundary. OpsKnight runs the web application and internal scheduler in the same Next.js process model, uses PostgreSQL for durable state, and does not require Redis or a separately deployed worker service.

For failure modes and scaling guidance, read [Technical architecture](../core-concepts/technical-architecture).

## Deployment topology

```mermaid
flowchart TB
  subgraph callers[Callers]
    browser[Desktop browser]
    mobile[Mobile browser or installed PWA]
    monitors[Monitoring and automation]
    publicUsers[Public status-page users]
  end

  proxy[Ingress or reverse proxy]

  subgraph replicas[One or more identical OpsKnight replicas]
    next[Next.js UI and route handlers]
    scheduler[Internal scheduler]
    memory[Per-process notification queue and circuit state]
    next --- scheduler
    next --- memory
  end

  postgres[(PostgreSQL)]
  channels[Email, SMS, web push, Slack, and webhooks]

  browser --> proxy
  mobile --> proxy
  monitors --> proxy
  publicUsers --> proxy
  proxy --> next
  next <--> postgres
  scheduler <--> postgres
  next --> channels
  scheduler --> channels
```

Every replica must use the same PostgreSQL database and compatible secrets. PostgreSQL coordinates scheduler ownership. The memory queue and circuit state are local to each replica.

## Inbound event transaction

```mermaid
sequenceDiagram
  autonumber
  participant Source as Monitoring source
  participant Route as API or integration route
  participant Event as Event processor
  participant DB as PostgreSQL
  participant FollowUp as Follow-up work
  participant Provider as Notification provider

  Source->>Route: POST trigger, acknowledge, or resolve
  Route->>Route: Authenticate and rate limit
  Route->>Route: Verify and normalize payload
  Route->>Event: Generic event
  Event->>DB: Begin serializable transaction
  DB-->>Event: Existing correlated incident, if any
  Event->>DB: Create or update incident and event data
  DB-->>Event: Commit
  Event--)FollowUp: Start escalation, webhooks, and notifications
  Event-->>Route: Incident result
  Route-->>Source: HTTP response
  FollowUp->>Provider: Attempt delivery
  Provider-->>FollowUp: Provider response
```

The incident database commit and external delivery are not one atomic transaction. An HTTP success proves that the accepted event reached its processing result; notification history and provider telemetry prove delivery.

## Correlation and lifecycle

```mermaid
stateDiagram-v2
  [*] --> OPEN: trigger creates incident
  OPEN --> OPEN: duplicate trigger correlates
  OPEN --> ACKNOWLEDGED: acknowledge
  OPEN --> SNOOZED: snooze
  OPEN --> SUPPRESSED: suppress
  OPEN --> RESOLVED: resolve
  ACKNOWLEDGED --> ACKNOWLEDGED: duplicate trigger correlates
  ACKNOWLEDGED --> SNOOZED: snooze
  ACKNOWLEDGED --> RESOLVED: resolve
  SNOOZED --> OPEN: snooze expires
  SNOOZED --> RESOLVED: resolve
  SUPPRESSED --> OPEN: unsuppress
  SUPPRESSED --> RESOLVED: resolve
  RESOLVED --> [*]
```

Escalation is progress associated with an incident; `ESCALATED` is not an incident status. Correlation uses the service and deduplication key and considers actionable states.

## Scheduler and durable jobs

```mermaid
flowchart TD
  boot[Node runtime starts] --> enabled{Internal cron enabled?}
  enabled -->|No| requestOnly[Serve requests without scheduled processing]
  enabled -->|Yes| lock{Acquire or retain PostgreSQL scheduler lock}
  lock -->|Another healthy owner| standby[Wait and check again]
  standby --> lock
  lock -->|Owner| heartbeat[Refresh lock heartbeat]
  heartbeat --> due[Run due scheduler work]

  due --> jobs[Claim BackgroundJob rows with SKIP LOCKED]
  due --> escalations[Process pending escalations]
  due --> retries[Retry failed notifications]
  due --> snooze[Unsnooze due incidents]
  due --> sla[Evaluate SLA work]
  due --> maintenance[Rollups, retention, and token or rate-limit cleanup]

  jobs --> outcome{Job outcome}
  outcome -->|Success| complete[Mark complete]
  outcome -->|Retryable failure| backoff[Increment attempts and schedule backoff]
  outcome -->|Attempts exhausted| failed[Mark failed]
  backoff --> jobs

  escalations --> delivery[Resolve target and attempt notifications]
  retries --> delivery
```

Background jobs are durable in PostgreSQL. A job stuck in `PROCESSING` can be reclaimed after its stale-processing interval. Scheduler progress stops when no healthy instance can own the database lock.

## Notification delivery boundaries

```mermaid
flowchart LR
  trigger[Incident or escalation action] --> resolve[Resolve users, preferences, and channels]
  resolve --> immediate[Bounded in-memory batch queue]
  resolve --> durable[PostgreSQL notification and job state]
  immediate --> provider[External provider]
  durable --> scheduler[Internal scheduler]
  scheduler --> provider
  provider --> result{Result}
  result -->|Success| delivered[Record delivered state]
  result -->|Retryable failure| retry[Store failure or next retry]
  result -->|Permanent failure| terminal[Record failed state]
  retry --> scheduler
```

The in-memory path is per process and can be lost during an abrupt exit. PostgreSQL-backed retry state survives a process restart, but neither path can guarantee that an unavailable third-party provider accepts a message.

## Mobile PWA and offline actions

```mermaid
flowchart TD
  online[Authenticated mobile UI under /m] --> api[OpsKnight routes]
  api --> db[(PostgreSQL)]
  api --> cache[Cache selected lists in encrypted localStorage]
  worker[Generated service worker plus custom worker] --> push[Receive web push]
  push --> open[Open payload URL or /m/notifications]

  offline{Browser offline?}
  offline -->|Read| cached[Show selected last-known list data]
  offline -->|Supported action| queue[Store request in IndexedDB queue]
  offline -->|Unsupported action| reconnect[Require a connection]
  queue --> sync[Background sync, online event, or manual retry]
  sync --> api
  api --> verify[Reload incident or notification and verify server state]
```

Supported offline writes are limited to mobile-list incident status changes and mobile notification read actions. Cached reads cover selected incident, notification, service, schedule, and team lists. Browser storage can be evicted or cleared, and queued requests can fail authentication, authorization, validation, rate-limit, or conflict checks. See [Mobile PWA](../deployment/mobile-pwa) before relying on this flow operationally.

## Source map

- Runtime and scheduler: `src/instrumentation.ts`, `src/lib/cron-scheduler.ts`
- Event transaction: `src/lib/events.ts`
- Durable jobs: `src/lib/jobs/queue.ts`
- Notification paths: `src/lib/notification-queue.ts`, `src/lib/notification-retry.ts`
- Mobile routes: `src/app/(mobile)/m`
- Offline queue and worker: `src/lib/offline-queue.ts`, `public/custom-sw.js`
