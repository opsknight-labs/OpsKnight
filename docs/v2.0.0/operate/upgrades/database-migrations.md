---
title: Operate database migrations
description: Back up, apply, verify, and recover OpsKnight schema migrations safely.
type: deployment
product_area: upgrades
audience: [operator]
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [prisma/migrations, docker-entrypoint.sh, scripts/auto-recover-migrations.ts]
---

# Operate database migrations

Back up PostgreSQL and verify restore access before changing schema. Read the
release notes, confirm application and database compatibility, and prevent mixed
application revisions from writing during an incompatible migration.

The production container applies committed migrations through its startup
workflow. Observe the migration job or application logs until completion; do
not start all replicas concurrently when the deployment procedure designates a
single migration owner.

Afterward, verify migration state, readiness, login, incident reads and writes,
scheduler/worker health, and a synthetic notification. If migration fails, stop
new writers, preserve logs and database state, follow [Migration fails](../../troubleshooting/upgrades/migration-fails/),
and restore only from a validated backup when forward recovery is unsafe.
