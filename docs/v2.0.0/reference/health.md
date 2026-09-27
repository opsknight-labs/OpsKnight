---
title: Health endpoint reference
description: Implemented liveness, readiness, and diagnostic health contracts.
type: reference
product_area: observability
audience: [operator, developer]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - src/app/api/health/route.ts
    - src/app/api/health/deep/route.ts
---

# Health endpoint reference

`GET /api/health` exposes the standard health contract and accepts the supported
mode used by deployment probes. `GET /api/health/deep` performs broader operator
diagnostics and should not be exposed publicly or polled as a cheap liveness
check.

Consumers must evaluate the response status and documented JSON state rather
than treating any HTTP response as healthy. Deployment manifests are the source
for probe timing and failure thresholds.

