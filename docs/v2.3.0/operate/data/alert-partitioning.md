---
title: Partition the Alert table by time
description: Opt-in conversion of the Alert table to monthly range partitions, with partition upkeep.
type: how-to
product_area: data
audience: [operator]
verification:
  level: source
  verified_at: 2026-11-21
  evidence:
    [
      scripts/partition-alerts.ts,
      src/lib/alerts/partitioning.ts,
      src/lib/alerts/partition-maintenance.ts,
    ]
---

# Partition the Alert table by time

Very large installs can convert `Alert` into monthly `RANGE` partitions on `createdAt`. Old months can then be detached in one quick step instead of deleted row by row. This is **opt-in**: no migration runs it, and an install that never runs the script is unchanged.

## Before you start

- Take a backup and rehearse a restore ([Back up and restore data](./backup-and-restore)).
- PostgreSQL 13 or later.
- Plan for about one extra copy of `Alert` on disk while the conversion runs.
- After the swap, the primary key is `("id", "createdAt")`. Alert IDs are still CUIDs, but PostgreSQL no longer enforces their uniqueness on its own. `AlertFingerprint` then references `("alertId", "alertCreatedAt")`.
- Any other foreign key that references `Alert`, or a unique index without `createdAt`, makes the planner refuse to run.
- `prisma migrate diff` will report drift on `Alert` after the swap. That is expected. Later expand-only migrations, such as adding a column, still apply to a partitioned table.

## Run the conversion

Every step is idempotent or guarded, and nothing changes without `--apply`.

```bash
# 1. Dry run: current state, row count, fingerprint createdAt mismatches (must be 0), full SQL plan
npx tsx scripts/partition-alerts.ts

# 2. Create the partitioned shadow table (monthly partitions + DEFAULT) and start mirroring writes
npx tsx scripts/partition-alerts.ts --apply --step=prepare

# 3. Copy existing rows in keyset batches (default 1000). The copy waits while database connections
#    are queued or paging is behind. After 5 minutes of waiting it stops and prints a resume cursor.
npx tsx scripts/partition-alerts.ts --apply --step=copy [--batch=1000] [--after=<createdAt>,<id>]

# 4. Swap: a short ACCESS EXCLUSIVE lock (lock_timeout 5s) renames the tables and indexes
npx tsx scripts/partition-alerts.ts --apply --step=swap

# 5. Once satisfied: stop mirroring to the old table, validate the fingerprint key, retire the old table
npx tsx scripts/partition-alerts.ts --apply --step=finalize
```

Copy exit codes: `0` means the copy is done, `2` means it paused (rerun with the printed `--after`), and `1` means an error.

How it stays consistent: once `prepare` has run, a trigger copies every insert, update and delete on `Alert` into the shadow table. Each copy batch reads its rows `FOR SHARE`, so a write that races the batch waits for it to finish and is then mirrored. `swap` refuses to run unless both tables have the same row count.

## Roll back

Between `swap` and `finalize`, a reverse trigger keeps the old table current. Rolling back is a rename, and no rows are lost:

```bash
npx tsx scripts/partition-alerts.ts --apply --step=rollback
```

`finalize` renames the old table to `Alert_unpartitioned_retired` but never drops it. Drop or archive it yourself once you are confident.

## Partition maintenance

New months must exist before alerts arrive for them. The Intelligence lane can create future partitions, and optionally detach old ones, on its retention sweep (every 15 minutes). It is **off by default** and does nothing while `Alert` is not partitioned.

| Setting (environment)              | Default | Meaning                                                                      |
| ---------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `ALERT_PARTITION_MAINTENANCE`      | off     | Set to `on` to enable.                                                       |
| `ALERT_PARTITION_MONTHS_AHEAD`     | `3`     | Future months kept created (1–24).                                           |
| `ALERT_PARTITION_RETENTION_MONTHS` | `0`     | Detach months that ended more than this many months ago. `0` never detaches. |

Each step runs with `lock_timeout = 2s` and is retried on the next sweep if the table is busy. Detached partitions remain as ordinary tables, so archive or drop them yourself. A detach is refused while `AlertFingerprint` rows still reference that month, and fingerprint retention clears those rows first.

An alert outside every monthly range lands in `Alert_pdefault` and is never rejected. If maintenance falls behind and the default partition holds rows for a month, creating that month's partition fails until you move those rows by hand.
