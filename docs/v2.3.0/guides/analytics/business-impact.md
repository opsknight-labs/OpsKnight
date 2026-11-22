---
title: Business impact report
description: Per business service uptime, incidents, MTTA, MTTR, impacted hours and the member that hurt most, with team and tier filters and a CSV export.
type: how-to
product_area: analytics
audience: [administrator, responder, operator]
verification:
  level: source
  verified_at: 2026-11-22
  evidence:
    - src/app/(app)/insights/business-impact/page.tsx
    - src/lib/business-services/impact-report.ts
    - src/lib/business-services/stats.ts
    - src/app/api/insights/business-impact/export/route.ts
---

# Business impact report

**Analytics → Business impact** (`/insights/business-impact`) shows how incidents affected each
[business service](../services/business-services) you can see. It needs the same access as
Analytics.

## What each column means

All numbers come from the business-service impact history, the same source as each business
service's overview.

| Column       | Meaning                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uptime       | Share of the period with no impact. Overlapping incidents count once (the union of impact intervals), so two incidents at the same time do not double the downtime. |
| Incidents    | Incidents that impacted the business service in the period. Impacts a responder unmarked are left out.                                                              |
| MTTA / MTTR  | Average time from incident start to acknowledgement / resolution, over those incidents.                                                                             |
| Impacted     | Hours of impact in the period (the same union).                                                                                                                     |
| Worst member | The member service whose own incidents impacted the business service longest, with its hours. Only members you can see are named.                                   |

The four cards at the top summarise the view: how many business services were impacted, total
impacted hours (summed across services, so shared incidents count once per service), average
uptime and the lowest uptime. **Impacted hours** charts the ten most affected services.

Rows are sorted worst first: most impacted time, then most incidents.

## Filter and export

- **Period:** last 7, 30 (default) or 90 days.
- **Owner team** and **Tier** narrow the list.

The view shows at most 100 business services; filter by team or tier to see the rest.

**Export CSV** (needs the report export permission) downloads exactly the rows on screen, with
the same filters. Text cells that start with `=`, `+`, `-` or `@` are prefixed with `'` so
spreadsheets do not run them as formulas.
