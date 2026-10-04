---
title: Analytics
description: Operational metrics, dimensions, and interpretation boundaries.
type: concept
product_area: analytics
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/app/(app)/analytics/, src/lib/reports/]
---

# Analytics

![Analytics overview generated from realistic incident history](/docs/v2.0.0/assets/analytics-overview.png)

Analytics summarizes operational records under explicit metric contracts.
Filters, time boundaries, aggregation, and empty-data semantics are part of each
metric's meaning.

Incident counts, acknowledgement time, resolution time, SLA attainment, and
service trends depend on the selected interval and scope. A missing value is not
always zero: it can mean no eligible records, incomplete history, or a metric
that is undefined for the chosen population.

Use analytics for operational direction and reports for reproducible sharing.
Record filters and time zone beside exported values, and use the incident audit
record for investigations requiring event-level precision.
