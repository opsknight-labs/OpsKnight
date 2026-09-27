---
title: Migrate from OpsKnight 1.x
description: Prepare and validate a supported upgrade from OpsKnight 1.x.
type: how-to
product_area: upgrades
audience: [operator, administrator]
verification:
  level: source
  verified_at: 2026-09-27
  evidence:
    - prisma/migrations/
    - deploy/compose/
    - deploy/kubernetes/
---

# Migrate from OpsKnight 1.x

Treat the migration as a data and runtime-topology change, not a container tag
swap.

1. Record the running image digest, database version, topology, environment
   configuration, integrations, and custom network policy.
2. Read every intervening release note and compare the generated configuration
   reference with the current deployment.
3. Take a database backup and prove it restores into a separate environment.
4. Rehearse the upgrade with a copy of production-shaped data. Run migrations
   once, then start the new runtime roles.
5. Verify authentication, permissions, schedules, escalation, notification
   providers, webhooks, status publication, health, and metrics.
6. Set a rollback decision point before accepting new writes. Database rollback
   uses the tested pre-upgrade backup; never assume a down migration exists.
7. Follow the [upgrade runbook](../operate/upgrades/upgrade) and retain the
   [rollback runbook](../operate/upgrades/rollback) beside the change record.
