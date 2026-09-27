---
title: Metrics reference
description: Operational metrics exposure and collection boundary.
type: reference
product_area: observability
audience: [operator, developer]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/app/api/metrics/route.ts
    - src/lib/metric-contract.ts
---

# Metrics reference

`GET /api/metrics` exposes the implemented operational metric contract when the
request satisfies the configured scrape-token boundary. Metric names, labels,
and aggregation semantics are defined in current source; dashboards must not
invent dimensions that are not emitted.

Keep label cardinality bounded and protect the endpoint through both credential
and network controls.
