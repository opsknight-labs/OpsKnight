---
title: Service graph
description: See how business services and technical services depend on each other with live health, focus on one service, and add, remove or review dependencies by dragging.
type: how-to
product_area: services
audience: [administrator, responder, viewer]
verification:
  level: source
  verified_at: 2026-11-27
  evidence:
    - src/app/(app)/services/graph/page.tsx
    - src/app/(app)/services/graph/actions.ts
    - src/components/service-graph/ServiceGraphExplorer.tsx
    - src/components/service-graph/ServiceGraphCanvas.tsx
    - src/components/service-graph/GraphSidePanel.tsx
    - src/components/service-graph/GraphInsightsPanel.tsx
    - src/components/service-graph/GraphLegend.tsx
    - src/components/service-graph/model.ts
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
  shows the name, the team, a status badge and the number of open incidents. Business service
  cards also show their tier and how many services they contain; Tier 0 cards have a heavier
  frame. The coloured left edge repeats the status: emerald operational, amber degraded or partial
  outage, crimson major outage, blue maintenance.
- Arrows point from a service to what it **depends on**, so business services sit on the left and
  the deepest dependencies on the right.
- The line pattern says what a line is: solid for a **hard** dependency, dash-dot for a **soft**
  one, dashed for a dependency the observer **suggests** and nobody has reviewed yet, dotted for a
  **member** service, and long dashes for a **supporting business service**.
- Each colour on a line has one meaning. Teal is measured traffic (thicker means more), with an
  error-rate label when errors are high. Status colours appear only on a highlighted path into an
  impacted service. Neutral lines labelled "new" or "removed" are **Changes**.
- **Legend**, at the bottom of the canvas, explains every shape, line and colour.
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

**Collapse business services** folds each business service into one card: its member services
are hidden and their dependency lines move onto it. A business service's side panel has
**Collapse into one node** and **Show member services** for just that one. Selecting a hidden
member, for example from a side panel, unfolds it again.

## Find and filter

- **Search** matches service and team names.
- **Team**, **Tier**, **Status** and **Origin** (declared or observed) narrow the services.
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
- **Highlight**: **Blast radius** (what depends on it) or **Root-cause path** (what it depends
  on), with a summary such as "4 affected · 3 at 1 hop, 1 at 2 hops". **Path from here** and
  **Path to here** highlight the path between two services,
- for a business service, **Collapse into one node**,
- **Ask Squire** about the selected service, and about the highlighted path when there is one,
  when Squire is enabled for you (the button uses your assistant's name). It opens Squire with the
  question filled in,
- what it **depends on** and what **uses** it. Select a name to select that service and move the
  canvas to it,
- links to the overview or service page and, if you can change dependencies,
  **Manage dependencies**.

Blast radius and paths follow every dependency that is loaded, not only the ones your filters
show. Services they reach that the filters hide are shown muted, and the summary says how many.

Press **Escape** or **Close details** to close it. On phones and small screens the panel opens as
a sheet at the bottom of the screen.

## Add, remove and review dependencies

Responders can change dependencies of their own teams' services; administrators can change any.

- **Add:** drag from the right-hand dot of the dependent service onto the left-hand dot of the
  service it depends on. Only technical services connect.
- **Remove:** click a solid dependency line to see its details (type, origin, traffic,
  confidence, criticality, evidence and note), then **Remove…** and confirm. A declared dependency
  also has **Edit**. The unlink button in the side panel removes one too.
- **Review a suggestion:** click a dashed line and choose **Accept** (it becomes a declared
  dependency) or **Reject** (it is not suggested again). The side panel has the same buttons.

Every change is written to the audit log (`intelligence.dependency.declared`, `.removed`,
`.approved`, `.rejected`) and immediately feeds incident correlation and business-service impact.

Anyone can click a line to see its details; only people who can change it see **Edit** and
**Remove…**.

## Look back in time

Open **Time travel** above the canvas and drag the slider, one day at a time over the last 90
days, or pick an exact time in **View the graph as of**. Ticks under the slider mark days when
incidents were opened and dependencies changed. A banner shows the time you are looking at;
**Back to now** returns to the live graph. Dependencies, incidents and statuses are replayed;
membership, maintenance windows and deleted services are not. Editing is off while you look at the
past.

## Export

**Export** downloads **JSON (loaded graph)** or **SVG (current layout)**. The SVG uses your current
light or dark theme and the positions on screen.

## Who sees what

Anyone who can read services can open the graph. It only ever shows services, business services
and incidents you can access; a dependency that touches a hidden service is left out and never
walked through in focus mode. Suggested dependencies appear only for roles that can read
intelligence suggestions. Stakeholders see open-incident counts but not the incidents.

## API and assistants

`GET /api/v2/business-services/{id}/graph?hops=1..3` returns the same graph around one business
service (`services:read`), and the MCP tool `business_service_graph` exposes it to assistants. See
the [API reference](../../reference/api/v2).
