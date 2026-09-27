---
title: Status page is not updating
description: Diagnose projection, routing, caching, and privacy configuration.
type: troubleshooting
product_area: status-pages
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/status-page-projection.ts, src/lib/status-page-public-data.ts]
---

# Status page is not updating

Confirm the intended page is enabled and the service is linked. Inspect the source
announcement, projector health, pending projection work, latest snapshot, route
operation, hostname resolution, and cache behavior. Review privacy filters when
data exists internally but is absent publicly. Do not bypass projection by editing
the public snapshot directly.

