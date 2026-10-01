---
title: Use mobile operational views
description: Navigate schedules, policies, services, teams, users, status, analytics, and postmortems on mobile.
type: how-to
product_area: mobile
audience: [responder, administrator]
reader: { status: READER_COMPLETE, task: Inspect operational context from the mobile application. }
verification:
  level: source
  verified_at: 2026-10-01
  evidence: ["src/app/(mobile)/m/layout.tsx", "src/components/mobile/mobileNavItems.tsx", "src/app/(mobile)/m/more/page.tsx"]
---

# Use mobile operational views

## Before you begin

Sign in with the same role used on desktop. Mobile views preserve server authorization and may intentionally omit desktop-only administration controls.

## Open the feature

Open `/m`. Use bottom navigation for primary views and **More** for schedules, policies, services, teams, users, status, analytics, and postmortems.

## Configure the view

1. Use search/filter controls where present.
2. Select a schedule to verify current/next on-call ownership.
3. Inspect the escalation policy linked to the affected service.
4. Open service/team/user detail for ownership context.
5. Use Status for customer-facing state, Analytics for scoped trends, and Postmortems for published learning.
6. Pull or manually refresh before making an incident decision.

## What OpsKnight does

Mobile pages query the same authorized product data with compact navigation and cached-state notices. Detail links keep the mobile route family; desktop preference can redirect when explicitly selected.

## Verify the view

Cross-check one schedule owner, service-policy relationship, and active incident/status result against desktop or an API response. Confirm the timestamp and offline/cached notices before relying on the data.

## Undo or reset

Clear filters or return through mobile navigation. To switch back to desktop, use the supported desktop preference control; clear it only through the dedicated preference route when necessary.

## Troubleshooting

- **View missing:** role/authorization may hide it; confirm desktop access.
- **Data stale:** reconnect and manually refresh.
- **Unexpected desktop redirect:** review the saved desktop preference.

## Next steps

- [Respond to incidents](./respond-to-incidents)
- [Offline state and updates](./offline-and-updates)
