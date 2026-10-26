---
title: Use the Command Center
order: 2
description: Watch live incidents, focus the feed, and read operational trends on the OpsKnight home dashboard and TV wallboard.
type: how-to
product_area: analytics
audience: [responder, administrator]
reader:
  {
    status: READER_COMPLETE,
    task: Use the Command Center to assess operational state and select the next incident-response action.,
  }
verification:
  level: source
  verified_at: 2026-10-25
  evidence:
    - src/app/(app)/page.tsx
    - src/components/dashboard/live/LiveCommandStrip.tsx
    - src/components/dashboard/live/LiveIncidentsPanel.tsx
    - src/components/dashboard/live/LiveFilterBar.tsx
    - src/components/dashboard/live/ResponderRail.tsx
    - src/components/dashboard/DashboardHistorySection.tsx
    - src/components/dashboard/live/LiveWallboard.tsx
    - src/lib/dashboard/live-incidents-engine.ts
    - src/app/api/dashboard/live/route.ts
---

# Use the Command Center

## Before you begin

Sign in and confirm that your team membership and incident permissions are
current. Everything on the page is authorization-scoped: two users can
legitimately see different incidents and counts.

## Open the feature

Select **Dashboard** in the main navigation or open `/`. The page has three
zones, top to bottom:

1. **Command Center**: current state at a glance.
2. **Live Incidents** with **Ops Pulse** beside it, sized so the whole panel fits
   on a desktop screen without scrolling the page.
3. **Trends & insights**: historical analytics for a selectable period.

## Configure the view

1. Select the operational scope (**All**, **My teams**, or **Mine**) from the top controls.
2. Filter the live incident feed by service, assignee, urgency, or keyword.
3. Choose the metrics card or queue item to focus on active priority incidents.
4. Select **Wallboard** when projecting to team TV displays.

## How the Command Center works

Read the Command Center indicators from left to right:

- **Status** shows _Operational_, _Degraded_ (active incidents, none critical),
  or _Critical_ (a critical incident, an SLA deadline within 10 minutes, or an
  SLA breached in the last hour).
- The **summary line** describes the situation in words, for example
  "5 critical on API Gateway / 2 due within 10 min / 3 critical unowned".
  Each phrase is a link that focuses the live feed on exactly those incidents.
- The **scope switch** chooses whose incidents the page shows: **All**,
  **My teams** (team-owned plus assigned to you), or **Mine**.
- **Wallboard** opens the TV view described below.

The metrics row counts the current active set in the chosen scope:

| Metric         | Meaning                                                            |
| -------------- | ------------------------------------------------------------------ |
| Triggered      | Active and not yet acknowledged.                                   |
| Critical       | P1 or high urgency.                                                |
| Acknowledged   | Being worked.                                                      |
| Unassigned     | No owner; the line below shows how many of them are critical.      |
| SLA at risk    | Next SLA deadline within 30 minutes, or breached in the last hour. |
| Resolved · 24h | Resolved in the last 24 hours, with MTTA and MTTR for that window. |

Select a metric to focus the live feed on it; select it again to return to all
active incidents. **Resolved · 24h** opens the resolved list on the Incidents
page.

## Work the Live Incidents panel

New incidents enter at the top within a couple of seconds, newest first.
Acknowledgement, reassignment, and escalation update rows in place. Resolved
incidents leave the feed.

1. Narrow the feed with **Search** (press `/`), **Service**, and **Filters**.
   Filters contains **Show** (All active, Critical, Mine, My teams, Unassigned,
   SLA risk), Team, Status, Urgency, and Assignment. Active choices appear as
   removable chips under **Filtered by**.
2. Use **Sort** to switch between **Newest first** and **Needs attention first**
   (critical, then SLA risk, then unowned).
3. Select **Live** to pause updates (press `p`). While paused, changes are
   buffered and counted as _pending_; resume to apply them.
4. Pin up to five incidents with the star. Pinned incidents stay in a strip at
   the top regardless of filters. Pins and row density are saved in this
   browser.
5. Act from the row: acknowledge (`a`), assign to yourself (`m`, or **+ Assign**
   on unowned rows), or open the incident. Move between rows with `j` and `k`.
6. Select **View all incidents** to open the same filters on the Incidents page.

The footer shows connection health (**Live**, **Stale**, **Offline**, or
**Session expired**) and when data was last synchronized. After a reconnect,
a filter change, or a missed update, the panel re-reads the authoritative list
instead of trusting buffered events.

## Use Ops Pulse

- **You**: whether you are on call and how many incidents are assigned to you.
- **Needs attention**: up to six incidents that are about to breach or have
  breached an SLA, critical without an owner, or escalated to level 2 or higher.
  **Sort feed** applies the same ordering to the live feed.
- **Hotspots**: services with the most active and critical incidents; select a
  service to focus the feed on it.
- **On call now**: current responders, plus schedules that currently have
  nobody on call (coverage gaps).

## Read Trends & insights

The period selector in this section changes only historical analytics. It
never filters the live feed or the Command Center counts. The section shows
created versus resolved incidents over the period, MTTA and MTTR compared with
the previous period, acknowledgement and resolution SLA compliance, an activity
timeline with type filters, team load, and the incident heatmap. Empty or
unavailable data is different from a measured zero.

## Show the dashboard on a TV (Wallboard)

Open **Wallboard** or `/wallboard` on the screen's browser and sign in once.
The wallboard is read-only and has no navigation chrome. It:

- enters true fullscreen with **Fullscreen** or `F` (hiding browser toolbars
  where the browser allows it; TV browsers that refuse the request keep working
  in a maximized window);
- cycles through views every 20 seconds (`Space` or **Auto-cycle** pauses;
  `?cycle=off` disables it);
- scales text with `+` and `-` or `?scale=` for distant screens;
- keeps the screen awake where supported, hides an idle cursor, shifts content
  slightly every few minutes to limit burn-in, and reloads itself every
  12 hours.

## Verify the result

1. Create a test incident and confirm it appears at the top of the feed without
   a page refresh.
2. Acknowledge it and confirm the row updates in place; resolve it and confirm
   it leaves the feed.
3. Select a metric and compare the feed with the equivalent Incidents page
   filter (**View all incidents**).
4. Switch the scope to **Mine** and compare it with your assigned incidents.
5. Change the Trends & insights period and confirm the live feed is unchanged.

## Change or undo the view

Scope, filters, sort, pause, pins, and density change only your view, never
incident records. Select **Clear all** (or remove each chip) and switch the
scope to **All** to return to the default. Incident actions taken from the feed
are real mutations; reverse them from the incident itself where the workflow
permits.

## Troubleshooting

- **A count differs from another user's count:** compare roles, team
  membership, service access, scope, and filters.
- **The footer says Stale or Offline:** the live channel is degraded. Data is
  re-read automatically when it recovers; do not treat a quiet feed as proof
  that nothing changed.
- **A new incident did not appear:** check whether updates are paused, whether a
  filter or scope excludes it, and whether you are allowed to see its service.
- **The feed is empty:** clear filters, switch the scope to **All**, and confirm
  relevant records exist and are visible to you.
- **An SLA number is unexpected:** compare the incident's selected SLA targets
  and lifecycle timestamps with the current policy; later policy changes do not
  rewrite an existing incident's contract.

## Next steps

- [Respond to an incident](../incidents/README)
- [Use Analytics](../analytics/use-analytics)
- [Read a saved dashboard](../reports/read-dashboard)
- [Understand permissions](../../reference/permissions)
