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

Capture three timestamps in UTC: the source incident/announcement update, the
latest projection/snapshot, and the public response observation. Then choose the
first stale boundary:

| Boundary | Evidence | Repair |
| --- | --- | --- |
| source | internal incident or announcement never changed | repair the originating workflow |
| membership/privacy | snapshot omits only one service or field | correct page membership or visibility policy |
| projector | source is newer than projection cursor/snapshot | restore projector worker and database access |
| origin route | snapshot is current but origin route is stale/erroring | inspect route operation and application logs |
| proxy/CDN | origin is current but public hostname is stale | correct cache key/TTL or purge the affected object |

Use an unauthenticated request so an administrator session cannot hide a public
route problem:

```bash
curl -sS -D /tmp/status-headers.txt -o /tmp/status-body.html \
  'https://<public-status-host>/<page-path>'
```

Review `Age`, `Cache-Control`, `ETag`, `Last-Modified`, and proxy-specific cache
headers. Do not attach the response body externally if the page is private or
contains subscriber data. A custom hostname failure with a healthy default route
points to DNS, TLS, host routing, or CDN configuration rather than projection.

If the snapshot is current but content is absent, review service membership and
privacy policy. If origin is current but the public response is stale, purge or
correct proxy caching. If projection is behind, repair the projector worker or
its database access and let supported replay logic catch up.

Verify on both the default route and any custom hostname. Preserve page ID,
service ID, source event time, projection cursor, snapshot time, route operation,
and response/cache headers.
