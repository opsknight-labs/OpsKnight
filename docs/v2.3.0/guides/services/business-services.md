---
title: Business services
description: Group technical services into what customers rely on, follow them in plain language, and see which business services an incident impacts.
type: how-to
product_area: services
audience: [administrator, responder, viewer]
verification:
  level: source
  verified_at: 2026-11-22
  evidence:
    - src/lib/business-services/commands.ts
    - src/lib/business-services/health.ts
    - src/lib/business-services/impacts.ts
    - src/lib/business-services/follower-notifications.ts
    - src/app/(app)/services/business/page.tsx
    - src/components/service/BusinessServiceForm.tsx
    - src/components/incident/detail/IncidentImpacts.tsx
    - src/app/api/v2/business-services/route.ts
---

# Business services

A business service is something customers rely on, such as **Checkout** or **Payments**, made of
the technical services that run it. Its status comes from **open incidents**, not from the
hand-set status of its technical services: a high-urgency incident on Payments API makes Checkout
a major outage. Dependencies, supporting business services, maintenance and responder marks count
too; [Business service health](../../concepts/business-service-health) explains every rule.

Nothing changes until you create one. Technical services, alerts and paging behave exactly as
before.

## Create a business service

Responders and Admins can create and edit business services.

1. Open **Services** and select **Business services**.
2. Select **New business service**.
3. Give it the name customers use, an optional description, a tier and an owner team you can
   see.
4. Pick its **technical services**. Each picker shows the first 50 and searches as you type. A
   technical service can belong to several business services. You can only add services you can
   see; members you cannot see stay when you save.
5. Optionally pick **followers** (see below), then select **Create business service**.

Only Admins can delete a business service. Deleting it removes it from status pages and stops
follower updates; its technical services are not changed. Status pages that show a business
service publish its technical services too. Removing a technical service from the business service
removes it from those pages again, unless another business service on the page still contains it
or an admin selected it on the page directly.

Criticality (`TIER_0` to `TIER_3`), impact thresholds, non-critical members and the business
services it depends on are set through the REST API for now (see below).

## Follow a business service

Anyone who can see a business service can **Follow** it from the list. Followers get a short,
plain-language in-app notification when a **public** incident that impacts it starts, when
responders pick it up, and when it is resolved, for example "Checkout is affected" and "Checkout
is back to normal". "Impacts" means the same as on the incident: directly, through a dependency or
a supporting business service, or marked by a responder. An incident a responder unmarked does
not notify followers.

Followers are never paged, and private incidents never notify them.

## Who sees what

People with organization-wide service access see every business service. Everyone else sees the
business services owned by one of their teams or containing one of their teams' services.

## Incidents show their impact

An incident shows **Impacts** with every business service it impacts that you can see, under the
incident title on desktop and mobile. Hover a chip for the reason (its service is affected, a
service it depends on is affected, a business service it relies on is affected, or marked by a
responder); select it to open the business service.

Responders can correct the list on desktop: **+ Impacted business service** marks one the engine
missed, even below its threshold, and the **x** on a chip unmarks one. An unmark is remembered, so
it does not come back when the incident changes. Both are audited.

`/m/status` lists business services with their engine status and how many of their services are
affected.

## Show business services on a status page

See [Status page layouts](../status-pages/business-service-layouts).

## API and MCP

| Operation                          | REST v2                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| List business services             | `GET /api/v2/business-services`                                                  |
| Create                             | `POST /api/v2/business-services`                                                 |
| Read, update, delete               | `GET/PATCH/DELETE /api/v2/business-services/{id}`                                |
| Incidents that impacted it         | `GET /api/v2/business-services/{id}/incidents`                                   |
| Impact timeline, uptime, MTTA/MTTR | `GET /api/v2/business-services/{id}/impact-timeline`                             |
| Mark or unmark an incident impact  | `PUT/DELETE /api/v2/incidents/{id}/business-service-impacts/{businessServiceId}` |

Every business service in a response carries `health` (status, since, reasons, open incident
count). The list filters by `q`, `tier`, `status`, `ownerTeamId` and `impactedOnly`, and sorts by
`newest` (default) or `name`. `memberServiceIds` and `followerUserIds` replace the whole set when
present; `criticality`, `impactMinUrgency`, `impactMaxPriority`, `nonCriticalServiceIds` and
`dependsOnBusinessServiceIds` change only when sent. Writes need an `Idempotency-Key`.

Assistants read business services with the MCP tools `business_services_list`,
`business_service_get`, `business_service_health` and `business_service_incidents`. Marking or
unmarking impact through MCP needs a person to approve it; configuration changes stay in the web
app and REST API.
