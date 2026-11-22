---
title: Status dashboard
description: See how every business service is doing right now, worst first, and build custom dashboards for a team, a product or leadership.
type: how-to
product_area: status_pages
audience: [viewer, responder, administrator]
verification:
  level: source
  verified_at: 2026-11-22
  evidence:
    - src/app/(app)/status-dashboard/page.tsx
    - src/app/(app)/status-dashboard/board-page.tsx
    - src/app/(app)/status-dashboard/[slug]/page.tsx
    - src/lib/business-services/dashboards.ts
    - src/components/business-service/StatusBoard.tsx
    - src/app/(mobile)/m/status/page.tsx
---

# Status dashboard

The status dashboard is the internal, at-a-glance view of the
[business services](../services/business-services) your company relies on. Open it from
**Status dashboard** in the sidebar, or press <kbd>⌘K</kbd> and type "status dashboard".

Everyone who can sign in can open it, including stakeholders who never get paged. It shows only
what is safe to share: each business service's status, how long it has had it, and counts. It never
shows incident titles, responders or timelines.

## Read the board

- **Overall banner**: "All business services are operational", or how many are impacted and the
  most affected ones with their status.
- **Announcements and maintenance**: active status page announcements, and maintenance windows on
  your business services that are running or start within 24 hours.
- **Tiles**: one per business service, **worst status first**, then the most critical tier. Each
  tile shows the status and since when, its tier, how many of its services are impacted and how
  many incidents are open. Select a tile to open the business service overview.

The board refreshes itself every 30 seconds while the tab is visible. **Refresh** under the header
updates it at once, and **Updated** says when it was computed.

You see the business services your teams own or contribute services to; people with
organization-wide service access see all of them.

## Custom dashboards

Responders and Admins can create boards with a chosen set of business services, for example
"Payments leadership" or "EU storefront".

1. Open **Status dashboard** and select **Manage dashboards**.
2. Select **New dashboard**, give it a name and a URL (`/status-dashboard/<url>`), and pick its
   business services.
3. Select **Create dashboard**. The board opens; share its link.

Custom dashboards appear as tabs above the board for everyone. Each person still sees only the
business services they can access on it. Edit or delete a dashboard from the same dialog; deleting
a dashboard does not change any business service. Creating, editing and deleting dashboards is
recorded in the audit log.

## On a phone

`/m/status` in the mobile app lists the same business services, worst first, with their status and
since when.

## If health is unavailable

If the board says **Health is unavailable right now**, live status could not be loaded. It tries
again on its next refresh, every 30 seconds.
