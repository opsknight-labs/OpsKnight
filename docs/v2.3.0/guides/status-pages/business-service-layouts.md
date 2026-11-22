---
title: Status page layouts
description: Show business services on a public status page, with merged 90-day history, and let visitors expand them to the technical services inside.
type: how-to
product_area: status_pages
audience: [administrator]
verification:
  level: source
  verified_at: 2026-11-22
  evidence:
    - src/components/status-page/StatusPageBusinessLayout.tsx
    - src/components/status-page/v3/ServiceHealthV3.tsx
    - src/components/status-page/v3/BusinessServiceHealthV3.tsx
    - src/lib/status-pages/business-services.ts
    - src/lib/status-pages/subscriptions.ts
    - src/app/api/v2/status-pages/[id]/business-services/route.ts
    - src/app/api/v2/status-pages/[id]/business-services/[businessServiceId]/override/route.ts
    - src/lib/status-pages/business-service-overrides.ts
    - src/lib/status-pages/snapshot.ts
    - src/components/status-page/StatusPageAnnouncementManager.tsx
---

# Status page layouts

A status page can list its services in three ways. Choose one in **Settings → Status pages →
your page → Services → Layout**.

| Layout                            | What visitors see                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Technical services** (default)  | One row per technical service, exactly as before.                                                            |
| **Business services**             | One row per business service with its worst status, merged 90-day history and uptime.                        |
| **Business services, expandable** | The same rows, each opening to show its technical services with their own history. Affected ones start open. |

Every row shows how many of its services are affected, for example "1 of 3 services affected".
Technical services that are in no business service on the page appear under **Other services**.

## How status, history and uptime are worked out

- **Status** is the worst current status of the business service's services on this page.
- **History** shows, for every moment in the last 90 days, the worst status of any of them.
- **Uptime** is the uptime of its least available service; incident counts are added up.

Only services published on this page count. Hide a technical service in the list below the layout
picker to keep it out of the business service's status.

## Set it up

1. [Create business services](../services/business-services) first.
2. In **Services → Layout**, pick **Business services** or **Business services, expandable**.
3. Add business services and order them with the arrows. Their technical services are added to the
   page automatically.
4. Save. The page republishes; removing a business service withdraws the page before it
   republishes, like any change that shows less.

Changing only the layout never publishes a service that is not already on the page.

## Rename, hide and order business services

Each business service on the page has its own settings, saved with the page:

- **Display name**: what visitors see, for example "Buying things" instead of "Checkout".
- **Show on page**: off keeps it off the page. Updates that name it still count its services.
- **Show services inside**: off keeps the row closed even on the expandable layout, so visitors
  see the business service but not its parts.
- **Order**: the arrows set the order on the page.

Hiding a business service or its services withdraws the page before it republishes, like any
change that shows less.

## Pin a status (override)

Sometimes the computed status is not what customers experience, for example during a partial
rollback. Pick a **Public status** next to a saved business service and **Apply now**. The page
shows that status instead of the computed one until the end time you choose (blank means 30 days,
the maximum). **Automatic (from incidents)** removes the pin. Overrides apply at once, without
saving the page, and every set, clear and expiry is in the audit log.

When an override ends, the background sweep clears it on its next run and the page shows the
computed status again. A pinned row shows no "since" time.

## Status since

An affected business service shows when the problem started, for example "Partial outage since
22 Nov, 10:04", in the page's time zone. On a live page a row that becomes affected opens again
even if the visitor closed it.

## Updates that name business services

When you write an incident update or an announcement, tick **Affected business services** to name
them instead of each technical service. Every service inside counts as affected:

- a maintenance that names a business service puts its services in maintenance on the page;
- the update card lists the business services, and the services and regions inside them;
- subscribers to those business services or their services get the update.

Public incident cards also list the business services on the page the incident affects.

## Subscribers

On a grouped page the subscribe form offers business services, plus any services outside them. A
subscriber who picks Checkout hears about incidents and announcements on any of Checkout's
services. People who pick nothing still get every update.

## Themes, mobile and accessibility

The layouts use the page's theme colours, so every built-in theme and custom CSS keep working, in
light and dark. Expandable rows are buttons that announce whether they are open, work with the
keyboard and have 44px touch targets on phones.

## API

`GET /api/v2/status-pages/{id}/business-services` returns the layout and business services.
`PUT` with `{ "serviceLayout": "BUSINESS_EXPANDABLE", "businessServiceIds": [...] }` sets them; it
needs `If-Match` and an `Idempotency-Key`. Add `businessServiceConfigs`, keyed by business service
id, to set `displayName`, `showOnPage` and `showMembers`.

`PUT /api/v2/status-pages/{id}/business-services/{businessServiceId}/override` with
`{ "status": "MAINTENANCE", "until": "2026-11-23T06:00:00Z" }` pins a status; `{ "status": null }`
clears it. Announcements accept `businessServices: [...]` to name affected business services. The public snapshot (`schemaVersion` 3) adds
`page.serviceLayout` and `businessServices` only on grouped pages; a page on the default layout
publishes the same snapshot as before.
