---
order: 3
---

# Observability & Operations Architecture (current code)

This document describes **what is implemented today** in OpsKnight.

---

## Scope

OpsKnight focuses on **incident operations**. Observability data is routed into incidents via
integrations and the Events API, then analyzed through the SLA/analytics engine.

Key sources:

- **Events API**: `/api/events` → `src/app/api/events/route.ts`
- **Integrations**: `/api/integrations/*` + `src/lib/integrations/*`
- **Incident & Alert models**: `Incident`, `Alert`, `IncidentEvent` in `prisma/schema.prisma`

---

## Ingestion Flow

```
External systems / integrations
  ├─ /api/integrations/*  (webhooks)
  └─ /api/events          (Events API v2)
             │
             ▼
processEvent()  →  Alert + Incident + IncidentEvent
src/lib/events.ts
```

Behavior:

- Writes raw alert data to `Alert`
- Deduplicates by `dedupKey`
- Creates or updates an `Incident`
- Emits timeline events to `IncidentEvent`
- Triggers downstream actions (notifications, escalation, status page webhooks)

---

## Incident Analytics & SLA

All analytics originate from `calculateSLAMetrics`:

- Engine: `src/lib/sla-server.ts`
- Supporting metrics: `src/lib/analytics-metrics.ts`
- Rollups: `src/lib/metric-rollup.ts` (writes to `IncidentMetricRollup`)
- Retention policy: `src/lib/retention-policy.ts` (`SystemSettings`)

The SLA engine powers:

- `/analytics`
- `/m/analytics`
- `/reports/executive`
- `/api/analytics/export`

---

## Background Processing

OpsKnight runs background work inside the app runtime (non-edge):

- **Scheduler**: `src/lib/cron-scheduler.ts`
- **Queue**: `src/lib/jobs/queue.ts` + `BackgroundJob`

Tasks handled include escalation steps, notification retries, SLA breach checks, and cleanup.

---

## Logs & Diagnostics

Current logging pipeline:

- **Client log ingest**: `/api/logs/ingest`
- **Logger**: `src/lib/logger.ts` (in-memory buffer)
- **Public log view**: `/api/public-logs`

Note: `LogEntry` exists in the Prisma schema, but the current ingest route writes to the
application logger, not to the database.

---

## Data Retention

Retention is configurable via `SystemSettings` and used throughout analytics:

- incidentRetentionDays
- alertRetentionDays
- logRetentionDays
- metricsRetentionDays
- realTimeWindowDays

Implementation: `src/lib/retention-policy.ts`

---

## Key Data Models (Prisma)

- **Incident pipeline**: `Incident`, `Alert`, `IncidentEvent`, `IncidentNote`
- **On-call & escalation**: `OnCallSchedule`, `OnCallShift`, `EscalationPolicy`, `BackgroundJob`
- **Analytics/SLA**: `IncidentMetricRollup`, `SLADefinition`, `SLASnapshot`
- **Notifications**: `Notification`, `NotificationProvider`, `InAppNotification`

---

## Where To Look in Code

- Integrations: `src/app/api/integrations/*`, `src/lib/integrations/*`
- Events API: `src/app/api/events/route.ts`, `src/lib/events.ts`
- Analytics: `src/app/(app)/analytics/page.tsx`, `src/lib/sla-server.ts`
- Retention: `src/lib/retention-policy.ts`
