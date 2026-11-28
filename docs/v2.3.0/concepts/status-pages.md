---
title: Status pages
description: Controlled public or private communication about service health.
type: concept
product_area: status-pages
audience: [administrator, responder]
verification:
  level: source
  verified_at: 2026-09-27
  evidence: [src/lib/status-page-projection.ts, src/lib/status-page-public-data.ts]
---

# Status pages

## Support boundary

Supported: up to two status pages per installation, service/component mapping,
controlled incident projection, subscribers, and the configured custom-domain
flow. Exactly one page is the default and serves `/status`; the second page has
its own unique slug and is served at `/status/{slug}`. Custom domains are per
page and unique. Not supported: more than two pages. A database model or
internal route does not expand this public support boundary.

Status pages publish deliberately scoped service and incident information.
Their audience, subscriptions, custom domains, and projections are separate
from internal incident access.

Operators map internal services to public components, then publish controlled
announcements and component state. Privacy settings decide which incident
fields, assignees, timestamps, and history can cross the boundary. Public output
must be derived through the projection layer, never by serializing an internal
incident directly.

Publication and subscriber delivery are asynchronous. Verify the public page
and delivery history independently, and account for cache, custom-domain, and
webhook delays during an incident.
