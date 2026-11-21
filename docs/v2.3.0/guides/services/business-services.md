---
title: Business services
description: Group technical services into what customers rely on, follow them in plain language, and see which business services an incident impacts.
type: how-to
product_area: services
audience: [administrator, responder, stakeholder]
verification:
  level: source
  verified_at: 2026-11-22
  evidence:
    - src/lib/business-services/commands.ts
    - src/lib/business-services/follower-notifications.ts
    - src/app/(app)/services/business/page.tsx
    - src/components/service/BusinessServiceForm.tsx
    - src/components/incident/detail/IncidentImpacts.tsx
    - src/app/api/v2/business-services/route.ts
---

# Business services

A business service is something customers rely on, such as **Checkout** or **Payments**, made of
the technical services that run it. Its status is the **worst status among its technical
services**, so one major outage in Payments API makes Checkout a major outage.

Nothing changes until you create one. Technical services, alerts and paging behave exactly as
before.

## Create a business service

Responders and Admins can create and edit business services.

1. Open **Services** and select **Business services**.
2. Select **New business service**.
3. Give it the name customers use, an optional description, a tier and an owner team.
4. Pick its **technical services**. A technical service can belong to several business services.
5. Optionally pick **followers** (see below), then select **Create business service**.

Only Admins can delete a business service. Deleting it removes it from status pages and stops
follower updates; its technical services are not changed.

## Follow a business service

Anyone who can see a business service can **Follow** it from the list. Followers get a short,
plain-language in-app notification when a **public** incident starts on one of its technical
services, when responders pick it up, and when it is resolved, for example "Checkout is
affected" and "Checkout is back to normal".

Followers are never paged, and private incidents never notify them.

## Who sees what

People with organization-wide service access see every business service. Everyone else sees the
business services owned by one of their teams or containing one of their teams' services.

## Incidents show their impact

An incident on a technical service shows **Impacts** with every business service that contains
it, under the incident title on desktop and mobile. `/m/status` lists business services with how
many of their services are affected.

## Show business services on a status page

See [Status page layouts](../status-pages/business-service-layouts).

## API and MCP

| Operation              | REST v2                                           |
| ---------------------- | ------------------------------------------------- |
| List business services | `GET /api/v2/business-services`                   |
| Create                 | `POST /api/v2/business-services`                  |
| Read, update, delete   | `GET/PATCH/DELETE /api/v2/business-services/{id}` |

`memberServiceIds` and `followerUserIds` replace the whole set when present. Writes need an
`Idempotency-Key` and the `services:write` scope. Assistants can read business services with the
MCP tool `business_services_list`; changes stay in the web app and REST API.
