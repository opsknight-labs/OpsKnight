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

