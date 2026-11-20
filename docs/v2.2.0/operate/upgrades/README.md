---
title: Upgrade operations
description: Plan, execute, verify, and if necessary roll back an OpsKnight upgrade.
type: concept
product_area: upgrades
audience: [operator]
verification: { level: source, verified_at: 2026-10-02, evidence: [prisma/migrations/, deploy/] }
---

# Upgrade operations

Upgrading from 2.1.x? Read [Upgrade to 2.2.0](./upgrade-to-2.2.0) for the release-specific changes first.

Read [database migrations](./database-migrations), execute the [upgrade runbook](./upgrade), and keep the [rollback runbook](./rollback) open during the change. Back up first, pin artifacts by digest, verify every runtime role, and do not call the change complete until a synthetic incident traverses the production path.
