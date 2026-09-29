---
title: Upgrade and roll back OpsKnight on Swarm
description: Back up, migrate, deploy, verify, and make a schema-aware rollback decision with maintained Swarm scripts.
type: deployment
product_area: deployment
audience: [operator, administrator]
keywords: [Swarm upgrade, rollback, migration]
reader:
  status: READER_COMPLETE
  task: Upgrade and validate an OpsKnight Swarm stack.
verification:
  level: source
  verified_at: 2026-09-29
  evidence: [deploy/swarm/scripts/deploy.sh, deploy/swarm/scripts/migrate.sh, deploy/swarm/scripts/rollback.sh]
---

# Upgrade and roll back OpsKnight on Swarm

## Prerequisites

Read release notes, [Database migrations](../../upgrades/database-migrations), and [Rollback](../../upgrades/rollback). Obtain the new digest, verified database/secret backups, current stack configuration, and rollback owner/window.

## Prepare the upgrade

Record current service images/configs/secrets, stack tasks, database state, health, and exact deployment inputs. Validate new capacity and image compatibility without changing unrelated settings.

## Run the upgrade

Export the new tested digest and invoke the maintained `deploy.sh`. It serializes deployment, creates versioned secrets, runs direct migration, deploys/prunes, waits for convergence, and checks readiness. Stop on migration failure.

## Verify the upgrade

Confirm every service uses the approved digest, desired tasks converge, one topology owns work, readiness passes internally/externally, and queues/roles/providers/database are healthy. Complete synthetic incident/notification/acknowledgement/resolution/projection and soak.

## Operate after acceptance

Retain prior image/configuration and backups for the rollback window. Confirm alerts, backup, certificates, secrets, and node-failure capacity still apply.

## Troubleshooting

**Migration fails:** keep old compatible workload state, preserve logs, and fix direct database/TLS/privilege/migration cause before retry.

**Mixed revisions:** inspect service update state/tasks and registry access on every node; do not accept partial convergence.

**Queue regression:** inspect role routing, provider/database capacity, and task health before scaling.

## Change or undo the upgrade

Use `deploy/swarm/scripts/rollback.sh` only after confirming prior image/schema compatibility. Stack rollback cannot reverse PostgreSQL migration. If incompatible, invoke the controlled database recovery plan rather than improvising reverse migration.

## Next steps

- [Swarm troubleshooting](./troubleshooting)
- [Production checklist](./production-checklist)

