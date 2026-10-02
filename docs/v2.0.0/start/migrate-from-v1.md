---
title: Migrate from OpsKnight 1.x
description: Inventory, rehearse, execute, verify, and recover a controlled OpsKnight 1.x to 2.0 migration.
type: how-to
product_area: upgrades
audience: [operator, administrator]
reader:
  status: READER_COMPLETE
  task: Migrate a production-shaped OpsKnight 1.x installation to 2.0 safely.
verification:
  level: source
  verified_at: 2026-09-30
  evidence: [prisma/migrations/, deploy/compose/, deploy/kubernetes/, scripts/validate-migrations.cjs]
---

# Migrate from OpsKnight 1.x

Treat this as a data, configuration, and runtime-topology migration—not a container-tag swap.

## Before you begin

Schedule a change window and identify migration, database, identity, notification, and rollback owners. Retain the current immutable image, configuration, encryption/authentication secrets, and a database backup proven through an isolated restore. Do not proceed without the exact key needed to decrypt stored provider credentials.

## Open the migration inventory

Record the 1.x image digest, PostgreSQL version, deployment topology, replica counts, environment, proxy, custom manifests, integrations, identity settings, notification providers, schedules, policies, status configuration, and current migration health. Export audit/configuration records required for comparison.

## Understand what changes

2.0 introduces explicit runtime roles, expanded configuration and authorization contracts, durable delivery/control-plane behavior, and additional database/index requirements. Existing data is upgraded in place by ordered Prisma migrations; there is no assumed down migration. A rollback after incompatible writes can require restoring the pre-upgrade database.

## Configure the rehearsal

1. Restore the production backup into an isolated environment.
2. Copy production configuration while replacing public URLs, provider destinations, and paging targets with controlled test values.
3. Pin the target 2.0 image digest and select integrated or split ownership deliberately.
4. Compare every setting with the generated [configuration reference](../reference/configuration/).
5. Run `npm run prisma:validate` and `npm run prisma:health` against the restored database.
6. Define rollback criteria before accepting any 2.0 production writes.

## Verify the rehearsal

Run one migration owner and require a zero exit code. Then verify administrator and responder login, permissions, teams/services, schedules and overrides, escalation, inbound trigger/recovery correlation, every enabled notification provider, ChatOps/Jira where used, status publication, audit export, health, metrics, backup, and restore. Record every difference from 1.x and its approved disposition.

## Apply the production migration

1. Freeze administrative changes and capture a final backup plus configuration/secret set.
2. Stop or hold old runtime owners so only one migration owner can run.
3. Follow [Database migrations](../operate/upgrades/database-migrations) with the direct PostgreSQL URL.
4. Deploy the exact rehearsed image and configuration.
5. Confirm all selected roles are Ready and no integrated/split ownership overlaps.
6. Execute the same acceptance journey used in rehearsal.
7. Re-enable inbound traffic and paging gradually while watching queue, provider, database, and error signals.

## Undo or roll back

Before incompatible 2.0 writes, restore the previous image and configuration only when the old runtime is compatible with the migrated schema. Otherwise stop writes and restore the verified pre-upgrade database plus matching secrets. Follow the [rollback runbook](../operate/upgrades/rollback); never edit `_prisma_migrations` or run `prisma db push` to force compatibility.

## Troubleshooting

**Migration health reports an unknown database migration:** stop. Deploy the release that owns that migration or investigate the database provenance before continuing.

**Stored integrations cannot decrypt:** restore the original `ENCRYPTION_KEY`; rotating it blindly cannot recover existing ciphertext.

**Login redirects to the old host:** set both public application URL values to the externally reachable HTTPS origin and restart every web replica.

**Notifications would reach real responders during rehearsal:** disable providers or replace destinations before sending any synthetic incident.

## Next steps

- [Upgrade OpsKnight](../operate/upgrades/upgrade)
- [Database migrations](../operate/upgrades/database-migrations)
- [Rollback](../operate/upgrades/rollback)
