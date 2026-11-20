---
title: Troubleshoot upgrades
description: Diagnose and safely recover from a failed database migration.
type: concept
product_area: upgrades
audience: [operator]
verification: { level: source, verified_at: 2026-10-02, evidence: [prisma/migrations/] }
---

# Troubleshoot upgrades

Use [Upgrade migration fails](./migration-fails). Stop further rollout, preserve the migration name and database error, confirm whether it committed partially, and follow the documented recovery path. Do not mark or rerun a migration blindly.
