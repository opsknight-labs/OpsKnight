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
