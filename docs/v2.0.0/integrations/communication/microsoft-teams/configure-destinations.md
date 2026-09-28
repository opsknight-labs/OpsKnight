---
title: Configure Microsoft Teams destinations
description: Map OpsKnight services to Teams channels and test Adaptive Card delivery.
type: how-to
product_area: chatops
audience: [administrator]
verification:
  level: source
  verified_at: 2026-09-28
  evidence: [src/app/api/microsoft-teams/destinations/route.ts, src/app/api/microsoft-teams/test/route.ts]
---

# Configure Microsoft Teams destinations

## Before you begin

Complete the Teams installation and ensure it is enabled in the configured tenant.

1. Open **Services → your service → Notifications**.
2. Enable Microsoft Teams and choose an installed team and channel.
3. Add up to three destinations.
4. Test every destination. A successful test sends a real Adaptive Card through
   Bot Framework transport.

All active destinations receive service lifecycle cards. Only one destination
per service can own automatic war-room behavior; regular card delivery remains
independent.

## Verify

Trigger a synthetic incident and confirm one card appears in every mapped
destination. Apply one action and verify all projections converge.
