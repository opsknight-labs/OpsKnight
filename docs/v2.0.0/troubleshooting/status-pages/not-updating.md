---
title: Status page is not updating
description: Diagnose projection, routing, caching, and privacy configuration.
type: troubleshooting
reader:
  status: READER_COMPLETE
  task: Diagnose, recover, and verify not updating.
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

## Locate the stale boundary

1. Confirm the incident or announcement is visible internally and linked to the page.
2. Compare the page's current projection cursor and latest generated snapshot.
3. Inspect status-projector readiness, oldest projector work, and last error.
4. Resolve the public slug/custom hostname and request it without an authenticated session.
5. Compare origin output with CDN/proxy output and its cache headers.

If the snapshot is current but content is absent, review service membership and
privacy policy. If origin is current but the public response is stale, purge or
correct proxy caching. If projection is behind, repair the projector worker or
its database access and let supported replay logic catch up.

Verify on both the default route and any custom hostname. Preserve page ID,
service ID, source event time, projection cursor, snapshot time, route operation,
and response/cache headers.
