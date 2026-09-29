---
title: Mobile and progressive web access
description: Responsive routes, installability, push, and offline boundaries.
type: concept
product_area: mobile
audience: [responder, administrator]
verification:
  level: test
  verified_at: 2026-09-27
  evidence: [tests/e2e/mobile-pwa.spec.ts, tests/e2e/mobile-responsive-matrix.spec.ts]
---

# Mobile and progressive web access

Mobile routes provide responsive access to core operational records and share
server-side authorization with desktop routes. Progressive web installation and
push require supported browsers and secure origins. Offline support is bounded;
incident mutations, fresh status, and provider actions require connectivity.

The installed app is another presentation of the same workspace, not a separate
data store or authorization domain. A responder who cannot see an incident on
desktop must not gain access through a mobile route or notification deep link.

Push delivery is advisory. Browser permission, subscription health, platform
background policy, and network reachability can all prevent a notification, so
escalation must retain another tested channel. Opening a stale notification must
refresh the incident before offering an action.

Validate the smallest supported viewport, touch targets, orientation changes,
install and uninstall, expired sessions, revoked subscriptions, and reconnect
behavior. Never describe cached content as current while the device is offline.

Supported routes are the responsive product routes exposed by the current
navigation and verified mobile tests. Installability requires a supported
browser and secure origin. A disabled PWA does not disable browser access, but
when PWA support is disabled, browser access can
continue but installation, service worker behavior, and push are unavailable.

Offline boundaries are explicit. Read-only cached presentation may remain, but
authentication and authoritative mutations require the server. An offline queue,
where a supported route offers one, must distinguish **queued** from **confirmed**,
apply bounded retry behavior after reconnect, and surface conflict instead of
overwriting a newer server state. A service worker update must not silently turn
a queued action into a confirmed action.

For troubleshooting, verify secure origin, browser permission, current
authentication, subscription state, service worker update state, connectivity,
and whether the attempted route supports offline behavior.
