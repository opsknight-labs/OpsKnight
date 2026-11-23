---
title: Service graph
description: See how business services and technical services depend on each other with live health, focus on one service, and add, remove or review dependencies by dragging.
type: how-to
product_area: services
audience: [administrator, responder, viewer]
verification:
  level: source
  verified_at: 2026-11-22
  evidence:
    - src/app/(app)/services/graph/page.tsx
    - src/app/(app)/services/graph/actions.ts
    - src/components/service-graph/ServiceGraphExplorer.tsx
    - src/components/service-graph/ServiceGraphCanvas.tsx
    - src/components/service-graph/DependencyMiniGraph.tsx
    - src/lib/intelligence/dependencies/graph-view.ts
    - src/app/api/v2/business-services/[id]/graph/route.ts
---

# Service graph

**Services → Service graph** (`/services/graph`) draws your
[business services](./business-services) and technical services, and how they depend on each
other, with live health. Use it to answer "what does Checkout rely on?" and "what else breaks if
Payments API is down?".

## Read the graph

- **Business services** are square-cornered cards; **technical services** are rounded. Each card
  shows the name, the team, a status badge and the number of open incidents. The coloured left
  edge repeats the status: emerald operational, amber degraded or partial outage, crimson major
  outage, blue maintenance.
- Arrows point from a service to what it **depends on**, so business services sit on the left and
  the deepest dependencies on the right. Dotted lines join a business service to its **members**.
  **Dashed** lines are dependencies the observer **suggests** and nobody has reviewed yet.
- A technical service's status comes from its worst open incident (high urgency: major outage,
  medium: partial outage, low: degraded), then from an active maintenance window. A business
  service's status comes from the [health engine](../../concepts/business-service-health).
- Hover a card to highlight it and everything one step away in either direction.

## Focus on one service

Open the graph from a business service's **Dependencies** tab (**Open in service graph**) or a
side panel's **Focus** button. The address then carries `?focus=bs:<id>` (business service) or
`?focus=svc:<id>` (technical service), and the graph shows only that service and everything
within **two dependency steps**, at most 500 services. Remove the **Focus** chip to see the
whole graph.

Without a focus the graph shows every service you can access (up to 2,000). Above 300 cards it
groups technical services into a box per team so the layout stays readable.

## Find and filter

- **Search** matches service and team names.
- **Team** keeps one team's services.
- **Impacted only** keeps services whose status is not operational.
- **Graph / List** switches to a table of the same services with status, open incidents and how
  many services each depends on and is used by. The list is the keyboard and screen-reader
  alternative to the canvas; its rows open the same side panel.

Filters stay in the address, so you can share a filtered view.

## The side panel

Click a card (or a list row) to open its panel:

- status and **why** (for a business service, each reason the engine found),
- owner team, and for a technical service who is **on call now** for the first step of its
  escalation policy,
- up to three **open incidents** you can open,
- what it **depends on** and what **uses** it,
- links to the overview or service page and, if you can change dependencies,
  **Manage dependencies**.

Press **Escape** or **Close details** to close it.

## Add, remove and review dependencies

Responders can change dependencies of their own teams' services; administrators can change any.

- **Add:** drag from the right-hand dot of the dependent service onto the left-hand dot of the
  service it depends on. Only technical services connect.
- **Remove:** click a solid dependency line (or the unlink button in the side panel), then
  confirm.
- **Review a suggestion:** click a dashed line and choose **Accept** (it becomes a declared
  dependency) or **Reject** (it is not suggested again). The side panel has the same buttons.

Every change is written to the audit log (`intelligence.dependency.declared`, `.removed`,
`.approved`, `.rejected`) and immediately feeds incident correlation and business-service impact.

## Who sees what

Anyone who can read services can open the graph. It only ever shows services, business services
and incidents you can access; a dependency that touches a hidden service is left out and never
walked through in focus mode. Suggested dependencies appear only for roles that can read
intelligence suggestions. Stakeholders see open-incident counts but not the incidents.

## API and assistants

`GET /api/v2/business-services/{id}/graph?hops=1..3` returns the same graph around one business
service (`services:read`), and the MCP tool `business_service_graph` exposes it to assistants. See
the [API reference](../../reference/api/v2).
