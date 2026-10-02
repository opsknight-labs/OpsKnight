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
  evidence: [prisma/migrations/, deploy/compose/, deploy/kubernetes/, scripts/validate-migrations.cjs, src/lib/api-keys.ts, src/lib/encryption.ts, src/lib/env-validation.ts]
---

# Migrate from OpsKnight 1.x

Treat this as a data, configuration, and runtime-topology migration—not a container-tag swap.

## Before you begin

Schedule a change window and identify migration, database, identity, notification, and rollback owners. Retain the current immutable image, configuration, encryption/authentication secrets, and a database backup proven through an isolated restore. Do not proceed without the exact key needed to decrypt stored provider credentials.

## Open the migration inventory

Record the 1.x image digest, PostgreSQL version, deployment topology, replica counts, environment, proxy, custom manifests, integrations, identity settings, notification providers, schedules, policies, status configuration, and current migration health. Export audit/configuration records required for comparison.

## Understand what changes

2.0 introduces explicit runtime roles, expanded configuration and authorization contracts, durable delivery/control-plane behavior, and additional database/index requirements. Existing data is upgraded in place by ordered Prisma migrations; there is no assumed down migration. A rollback after incompatible writes can require restoring the pre-upgrade database.

## Preserve secrets and encryption keys

2.0 refuses to start in production with missing, placeholder, or reused signing secrets. Prepare the secret set before the window:

| Setting | 1.x state | Action for 2.0 |
| --- | --- | --- |
| `NEXTAUTH_SECRET` | Set | Keep the exact value. Do not rotate it in the same window. |
| `NEXTAUTH_SECRET` | Left at a shipped placeholder such as `change_this_to_a_random_secret_in_production` | 2.0 rejects it. Set a new strong value. Existing sessions end; existing API keys still migrate because 2.0 also checks the shipped 1.x placeholders. |
| `NEXTAUTH_SECRET` | Not set (1.x derived it from `ENCRYPTION_KEY`) | Set a new strong value. Existing sessions end; existing API keys still migrate because 2.0 also checks the 1.x derived value. |
| `API_KEY_SECRET` | Set | Keep the exact value if it is at least 32 characters and differs from `NEXTAUTH_SECRET`; otherwise generate a new independent value. |
| `API_KEY_SECRET` | Not set | Generate a new independent value, for example `openssl rand -base64 48`. |
| `ENCRYPTION_KEY` | Set | Keep the exact 64-character hex value. It decrypts every 1.x provider credential. |
| `ENCRYPTION_KEY` | Not set with the 1.x Compose file or 1.x Kubernetes sample Secret | 1.x encrypted with the public default key `9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08`, which 2.0 rejects as an active key. Set `ENCRYPTION_KEYS=k2:<new-64-hex>,k1:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08`. 2.0 reads existing data with `k1` only and writes with `k2`. Re-encrypt stored secrets, then remove `k1`. |

API keys and status-page API tokens issued by 1.x keep working. On the first successful request, 2.0 matches the stored 1.x scrypt hash using the retained `NEXTAUTH_SECRET`, a 1.x `API_KEY_SECRET`, the 1.x `ENCRYPTION_KEY`-derived secret, or a shipped 1.x `NEXTAUTH_SECRET` placeholder, then rewrites that record to the 2.0 HMAC under the new `API_KEY_SECRET`. Later requests use the new hash directly. Invalid or revoked credentials stay rejected. Keys that are never used before a later `NEXTAUTH_SECRET` rotation can no longer migrate, so rotate `NEXTAUTH_SECRET` only after legacy API consumers have authenticated at least once or their keys have been recreated.

### Move from `ENCRYPTION_KEY` to an `ENCRYPTION_KEYS` keyring

You can stay on `ENCRYPTION_KEY` for the upgrade. 2.0 treats it as key ID `k1`, and new writes use authenticated `v3:k1:` envelopes. Move to a keyring in a separate change after the upgrade is accepted:

1. Keep the current key as `k1` and add a new key as the first, active entry: `ENCRYPTION_KEYS=k2:<new-64-hex>,k1:<existing-ENCRYPTION_KEY>`.
2. Leaving `ENCRYPTION_KEY` set to the same `k1` value during the transition is safe; a valid keyring stays authoritative.
3. Roll the keyring to every web, worker, scheduler, and migration role in the same change. New writes use `k2`; 1.x `v2`/`v1` data and existing `v3:k1:` data stay readable.
4. Remove `k1` only after stored secrets have been re-encrypted under `k2` and you no longer need any backup that still depends on `k1`.

Never relabel the historical key, for example as `legacy:`, and never drop it while ciphertext or backups still depend on it. A publicly known or weak key is accepted only as a non-active, decrypt-only entry; production startup rejects it as the first (active) entry.

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

Rolling back the image without restoring the database has credential consequences:

- 1.x cannot read API keys or status-page API tokens that 2.0 already migrated to the HMAC hash, or keys created on 2.0. Those clients receive 401 until you restore the pre-upgrade database or recreate their keys.
- 1.x cannot decrypt `v3:` provider credentials that 2.0 wrote. Restore the pre-upgrade database, or re-enter those credentials on 1.x.
- 1.x ignores `ENCRYPTION_KEYS`. If you rolled out a keyring, restore the original `ENCRYPTION_KEY` value before starting 1.x.

## Troubleshooting

**Migration health reports an unknown database migration:** stop. Deploy the release that owns that migration or investigate the database provenance before continuing.

**Stored integrations cannot decrypt:** restore the original `ENCRYPTION_KEY`, or keep it in `ENCRYPTION_KEYS` with its original ID (`k1` for a former single key). Rotating it blindly cannot recover existing ciphertext.

**Login redirects to the old host:** set both public application URL values to the externally reachable HTTPS origin and restart every web replica.

**Existing API keys return 401 after upgrade:** verify that the original `NEXTAUTH_SECRET` (and the 1.x `API_KEY_SECRET` or `ENCRYPTION_KEY`, if it was set) is preserved and that the new `API_KEY_SECRET` is present and independent. Restoring the retained 1.x values lets the lazy compatibility path recognize and migrate legacy hashes. Do not regenerate them as a troubleshooting shortcut.

**Notifications would reach real responders during rehearsal:** disable providers or replace destinations before sending any synthetic incident.

## Next steps

- [Upgrade OpsKnight](../operate/upgrades/upgrade)
- [Database migrations](../operate/upgrades/database-migrations)
- [Rollback](../operate/upgrades/rollback)
