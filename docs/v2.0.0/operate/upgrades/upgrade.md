---
title: Upgrade OpsKnight
description: Stage an application and schema upgrade with explicit verification.
type: deployment
product_area: upgrades
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - scripts/validate-migrations.cjs
    - scripts/check-migration-health.cjs
---

# Upgrade OpsKnight

Read the release notes and supported migration path, capture a verified backup,
validate image provenance, and rehearse the upgrade against restored data. During
the change, stop duplicate migration owners, run migration checks, apply schema
changes once, then roll application roles in the documented compatibility order.

Verify readiness, deep health, authentication, incident lifecycle, notification
processing, scheduler progress, status projection, integrations, and mobile
routes before completing the window.

