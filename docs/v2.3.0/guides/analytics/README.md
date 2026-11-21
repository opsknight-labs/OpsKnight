---
title: Analytics
order: 2
description: How your services and responders are performing — what each section shows, how filters, ranges and timezones work, what every metric means, and how to export.
type: concept
product_area: analytics
audience: [administrator, responder, operator]
verification:
  level: source
  verified_at: 2026-11-20
  evidence:
    - src/app/(app)/insights/page.tsx
    - src/lib/analytics/definitions.ts
    - src/lib/analytics/params.ts
    - src/lib/analytics/window.ts
    - src/app/api/insights/export/route.ts
---

# Analytics

**Analytics** answers "how are we doing, and where should we improve?" for the incidents you can
see. It replaces the 2.1.0 Analytics page: every number is now computed in the database over every
matching incident (no sampling), each section loads on its own, and the page works on phones —
there is no separate mobile Analytics screen any more; `/m` links open `/analytics`.

- [Use Analytics](./use-analytics.md): filters, ranges, comparison, timezones, metric definitions
  and the CSV export.
- Unchanged in 2.2.0: [Reports and dashboards](../reports/README.md) and the
  [metrics reference](../../reference/metrics.md).

## Sections

| Section                               | What it shows                                                                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Key metrics                           | Eight tiles: Incidents, Open now, MTTA, MTTR, Ack SLA met, Resolve SLA met, Escalated, After hours. MTTA and MTTR show the median with the p90 beneath. |
| Incident volume                       | Incidents created per hour, day, week or month, split by urgency.                                                                                       |
| Time to acknowledge / Time to resolve | Median and p90 per bucket.                                                                                                                              |
| Services                              | Reliability per service. Select a service to filter the whole page.                                                                                     |
| Responder load                        | Assigned incidents by time of day in each responder's own timezone, plus scheduled on-call hours.                                                       |
| When incidents happen                 | Day-of-week by hour heatmap in your timezone.                                                                                                           |
| Noise                                 | Alerts per incident, auto-resolved share, the loudest services and recurring incident titles.                                                           |
| Follow-through                        | Postmortems published for resolved high-urgency incidents, and open and overdue action items.                                                           |

A section that fails shows its own error with a retry; the rest of the page keeps working.

## Permissions

- **View** needs the `report.read` capability (`REPORT_READ`).
- **Export CSV** needs `report.export` (`REPORT_EXPORT`); the button is hidden without it and the
  export endpoint returns 403.
- Everything is scoped to the incidents you may read: users who are not administrators see
  incidents from services they can access, plus incidents assigned to them or that they watch. The
  page says so in a notice above the sections.
