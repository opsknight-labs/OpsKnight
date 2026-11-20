---
title: Schedule service maintenance windows
description: Hold new alerts for one or more services during planned work, repeat windows on a schedule, and decide what happens to held alerts when the window ends.
type: how-to
product_area: services
audience: [administrator, responder]
reader:
  status: READER_COMPLETE
  task: Schedule, verify, end, and remove a maintenance window for one or more services.
verification:
  level: source
  verified_at: 2026-11-20
  evidence:
    - src/components/service/ServiceMaintenancePanel.tsx
    - src/app/(app)/services/[id]/maintenance-actions.ts
    - src/app/(app)/incidents/page.tsx
    - src/lib/admin-health.ts
    - src/app/api/v2/maintenance-windows/route.ts
    - src/app/api/v2/maintenance-schedules/route.ts
    - prisma/migrations/20261117000100_service_maintenance_windows/migration.sql
---

# Schedule service maintenance windows

New in 2.2.0. A maintenance window tells OpsKnight that planned work is under way on one or more
services, so alerts that the work causes do not page anyone.

## Before you begin

- You need permission to change every service the window covers (the same permission as editing the
  service).
- Know the start time, the expected duration, and which services the work touches.
- If customers should see the work, have a status page that shows those services.

## Open the feature

Open **Services**, select a service, and choose the **Maintenance** tab. Services in an active window
show an **In maintenance** badge in the service list and on the service page.

## Configure a window

1. Select **Schedule maintenance**.
2. Enter a **Title** and, optionally, a **Description**.
3. Under **Repeat**, keep **Does not repeat** for one-off work, or choose **Daily**, **Weekly** (pick the
   days), or **Monthly** (pick the day; it is moved to the last day of shorter months). Set how often it
   repeats, the start date and time, the **Time zone**, and an optional end date.
4. For one-off work, choose **Start now** or a start time, then a **Duration** (30 minutes to 24 hours).
5. Select the services. One window can cover several services.
6. Under **When the window ends**, choose:
   - **Page for alerts that are still firing (recommended)**: held incidents whose alerts are still
     open are released and page normally.
   - **Auto-resolve every held incident**.
7. Optionally turn on **Show on status pages and notify their subscribers** to publish a maintenance
   announcement on each status page that shows the services.
8. Select **Schedule**, **Start maintenance**, or **Schedule recurring**.

## How a maintenance window works

- While a window is active, a **new** alert for a covered service opens a **Suppressed** incident linked
  to the window. Nobody is paged, the SLA clock is paused, and Runbooks are not started.
- Incidents that were already open keep escalating. Incidents a person creates by hand are never held.
  A resolve event from the source still closes a held incident.
- Held incidents are hidden from the default incident list; the **Suppressed** filter shows them. The
  incident page shows **Held by maintenance window** with a link to the window.
- Whether a window is active is worked out from its start and end times, so a stalled scheduler cannot
  leave a service in maintenance. At the end, the scheduler releases or resolves held incidents in
  batches; a very large backlog finishes over several scheduler ticks.
- Recurring schedules create their occurrences up to 14 days ahead as ordinary windows. Editing,
  pausing, or deleting a schedule changes only upcoming occurrences.
- The same windows are available through REST API v2 (`/api/v2/maintenance-windows` and
  `/api/v2/maintenance-schedules`, scopes `services:read` and `services:write`) and the mobile app.

## Verify the result

1. Confirm the service shows **In maintenance** during the window.
2. Send a test event to the service's integration and confirm it creates a **Suppressed** incident that
   does not page the on-call responder.
3. After the window ends, confirm the held incident was released or resolved as you chose.

## Change or undo it

- **End now** ends an active window early. It asks for confirmation, because paging resumes.
- **Delete** removes an upcoming window. A window that holds incidents cannot be deleted; end it
  instead.
- Recurring schedules can be edited, paused, resumed, or deleted from the **Maintenance** tab.

## Troubleshooting

- **An alert still paged during maintenance:** the incident was already open before the window started,
  was created by a person, or belongs to a service the window does not cover.
- **Held incidents were not released at the end:** open **Settings → System → Health**. The
  **Maintenance windows** check reports windows that ended but were not processed, which usually means
  the scheduler role is not running.
- **You cannot select a service:** you need permission to change that service.

## Next steps

- [Create and manage a service](./manage-service)
- [Publish a status update](../status-pages/publish-update)
- [REST API v2 reference](../../reference/api/v2)
