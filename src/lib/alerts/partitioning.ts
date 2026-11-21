/**
 * Opt-in Alert time partitioning: pure SQL planning, no database access, so the conversion script, the lane
 * maintenance job and the unit tests share one generator. Nothing here runs from a migration.
 *
 * Shape: "Alert" becomes RANGE-partitioned by "createdAt" with one partition per UTC month ("Alert_pYYYYMM")
 * plus a DEFAULT partition so an insert outside every range never fails. The primary key becomes
 * ("id", "createdAt") because a partitioned table's unique keys must contain the partition key.
 */

export const PARTITIONED = 'Alert_partitioned';
export const UNPARTITIONED = 'Alert_unpartitioned';
export const RETIRED = 'Alert_unpartitioned_retired';
export const DEFAULT_PARTITION = 'Alert_pdefault';
const MIRROR_FORWARD = 'alert_partition_mirror_forward';
const MIRROR_REVERSE = 'alert_partition_mirror_reverse';
const NAME_MAX = 63;

export interface IndexDef {
  name: string;
  /** pg_get_indexdef output for the live "Alert" table. */
  definition: string;
  unique: boolean;
  primary: boolean;
}

export interface ForeignKeyDef {
  name: string;
  /** Table that owns the constraint. */
  table: string;
  /** pg_get_constraintdef output. */
  definition: string;
}

export interface ConversionInput {
  indexes: readonly IndexDef[];
  /** Foreign keys declared on "Alert" (to Service, Incident). */
  ownForeignKeys: readonly ForeignKeyDef[];
  /** Foreign keys on other tables that reference "Alert". */
  referencingForeignKeys: readonly ForeignKeyDef[];
  /** Oldest alert, or null on an empty table. */
  oldest: Date | null;
  now: Date;
  monthsAhead: number;
}

export interface ConversionPlan {
  prepare: string[];
  swap: string[];
  finalize: string[];
  rollback: string[];
}

export const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

export const monthStart = (date: Date) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
export const addMonths = (date: Date, months: number) =>
  new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));

export const partitionName = (month: Date) =>
  `Alert_p${month.getUTCFullYear()}${String(month.getUTCMonth() + 1).padStart(2, '0')}`;

/** The month a partition name stands for, or null for the default or a foreign name. */
export function partitionMonth(name: string): Date | null {
  const match = /^Alert_p(\d{4})(\d{2})$/.exec(name);
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? new Date(Date.UTC(Number(match[1]), month - 1, 1)) : null;
}

/** Inclusive month range [from, to]. */
export function monthsBetween(from: Date, to: Date): Date[] {
  const months: Date[] = [];
  for (let month = monthStart(from); month <= monthStart(to); month = addMonths(month, 1))
    months.push(month);
  return months;
}

const literal = (date: Date) => `'${date.toISOString().slice(0, 19).replace('T', ' ')}'`;

export function createPartitionSql(parent: string, month: Date): string {
  return `CREATE TABLE IF NOT EXISTS ${ident(partitionName(month))} PARTITION OF ${ident(parent)} FOR VALUES FROM (${literal(month)}) TO (${literal(addMonths(month, 1))})`;
}

const shadowName = (name: string, suffix: string) =>
  `${name.slice(0, NAME_MAX - suffix.length)}${suffix}`;

/** Rewrites one live index definition onto the partitioned table under a temporary name. */
export function partitionedIndexSql(index: IndexDef): string {
  const rewritten = index.definition
    .replace(
      // eslint-disable-next-line security/detect-unsafe-regex -- linear, anchored, over pg_get_indexdef output
      /^CREATE (UNIQUE )?INDEX [^ ]+ ON (\w+\.)?"Alert(?:_unpartitioned)?"/,
      (_all, unique, schema) =>
        `CREATE ${unique ?? ''}INDEX ${ident(shadowName(index.name, '_p'))} ON ${schema ?? ''}${ident(PARTITIONED)}`
    )
    // Partitioned parents cannot be indexed CONCURRENTLY; the table is new and empty here.
    .replace(/ CONCURRENTLY /, ' ');
  if (rewritten === index.definition)
    throw new Error(`Unrecognised index definition for ${index.name}`);
  return rewritten;
}

function mirrorFunctionSql(name: string, target: string, keyed: string): string {
  return `CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $mirror$
BEGIN
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    DELETE FROM ${ident(target)} WHERE ${keyed};
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    INSERT INTO ${ident(target)} SELECT (NEW).* ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END
$mirror$`;
}

const trigger = (table: string, fn: string) =>
  `CREATE TRIGGER ${fn} AFTER INSERT OR UPDATE OR DELETE ON ${ident(table)} FOR EACH ROW EXECUTE FUNCTION ${fn}()`;

/**
 * The only supported inbound reference: AlertFingerprint carries the alert's createdAt, so its key can move
 * to the composite ("id", "createdAt"). Anything else must be handled by hand first.
 */
function compositeReference(fk: ForeignKeyDef): string {
  if (fk.table !== 'AlertFingerprint')
    throw new Error(
      `Unsupported foreign key ${fk.table}.${fk.name} references "Alert"; it must reference ("id", "createdAt") first`
    );
  return `ALTER TABLE ${ident(fk.table)} ADD CONSTRAINT ${ident(fk.name)} FOREIGN KEY ("alertId", "alertCreatedAt") REFERENCES "Alert"("id", "createdAt") ON DELETE CASCADE NOT VALID`;
}

export function planConversion(input: ConversionInput): ConversionPlan {
  for (const index of input.indexes)
    if (index.unique && !index.primary && !/"createdAt"/.test(index.definition))
      throw new Error(
        `Unique index ${index.name} does not include "createdAt" and cannot exist on a partitioned table`
      );
  if (!Number.isInteger(input.monthsAhead) || input.monthsAhead < 1 || input.monthsAhead > 24)
    throw new Error('monthsAhead must be between 1 and 24');
  const secondary = input.indexes.filter(index => !index.primary);
  const months = monthsBetween(input.oldest ?? input.now, addMonths(input.now, input.monthsAhead));

  const prepare = [
    `CREATE TABLE ${ident(PARTITIONED)} (LIKE "Alert" INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING STORAGE INCLUDING COMMENTS) PARTITION BY RANGE ("createdAt")`,
    `ALTER TABLE ${ident(PARTITIONED)} ADD CONSTRAINT ${ident(`${PARTITIONED}_pkey`)} PRIMARY KEY ("id", "createdAt")`,
    ...months.map(month => createPartitionSql(PARTITIONED, month)),
    `CREATE TABLE IF NOT EXISTS ${ident(DEFAULT_PARTITION)} PARTITION OF ${ident(PARTITIONED)} DEFAULT`,
    ...secondary.map(partitionedIndexSql),
    ...input.ownForeignKeys.map(
      fk => `ALTER TABLE ${ident(PARTITIONED)} ADD CONSTRAINT ${ident(fk.name)} ${fk.definition}`
    ),
    // From here every write to "Alert" is mirrored; the batched copy fills in the rest.
    mirrorFunctionSql(
      MIRROR_FORWARD,
      PARTITIONED,
      `"id" = OLD."id" AND "createdAt" = OLD."createdAt"`
    ),
    trigger('Alert', MIRROR_FORWARD),
  ];

  const pkey = input.indexes.find(index => index.primary)?.name ?? 'Alert_pkey';
  const renameIndexes = (from: 'live' | 'shadow') =>
    secondary.flatMap(index =>
      from === 'live'
        ? [
            `ALTER INDEX ${ident(index.name)} RENAME TO ${ident(shadowName(index.name, '_unpart'))}`,
            `ALTER INDEX ${ident(shadowName(index.name, '_p'))} RENAME TO ${ident(index.name)}`,
          ]
        : [
            `ALTER INDEX ${ident(index.name)} RENAME TO ${ident(shadowName(index.name, '_p'))}`,
            `ALTER INDEX ${ident(shadowName(index.name, '_unpart'))} RENAME TO ${ident(index.name)}`,
          ]
    );

  const swap = [
    `SET LOCAL lock_timeout = '5s'`,
    `LOCK TABLE "Alert" IN ACCESS EXCLUSIVE MODE`,
    `DROP TRIGGER ${MIRROR_FORWARD} ON "Alert"`,
    ...input.referencingForeignKeys.map(
      fk => `ALTER TABLE ${ident(fk.table)} DROP CONSTRAINT ${ident(fk.name)}`
    ),
    `ALTER TABLE "Alert" RENAME TO ${ident(UNPARTITIONED)}`,
    `ALTER INDEX ${ident(pkey)} RENAME TO ${ident(`${UNPARTITIONED}_pkey`)}`,
    ...renameIndexes('live'),
    `ALTER TABLE ${ident(PARTITIONED)} RENAME TO "Alert"`,
    `ALTER INDEX ${ident(`${PARTITIONED}_pkey`)} RENAME TO ${ident(pkey)}`,
    ...input.referencingForeignKeys.map(compositeReference),
    // Keep the old table current until finalize, so rollback is a rename with no data loss.
    mirrorFunctionSql(MIRROR_REVERSE, UNPARTITIONED, `"id" = OLD."id"`),
    trigger('Alert', MIRROR_REVERSE),
  ];

  const finalize = [
    `DROP TRIGGER IF EXISTS ${MIRROR_REVERSE} ON "Alert"`,
    `DROP FUNCTION IF EXISTS ${MIRROR_REVERSE}()`,
    `DROP FUNCTION IF EXISTS ${MIRROR_FORWARD}()`,
    ...input.referencingForeignKeys.map(
      fk => `ALTER TABLE ${ident(fk.table)} VALIDATE CONSTRAINT ${ident(fk.name)}`
    ),
    // Kept, not dropped: the operator archives or drops it once satisfied.
    `ALTER TABLE ${ident(UNPARTITIONED)} RENAME TO ${ident(RETIRED)}`,
  ];

  const rollback = [
    `SET LOCAL lock_timeout = '5s'`,
    `LOCK TABLE "Alert", ${ident(UNPARTITIONED)} IN ACCESS EXCLUSIVE MODE`,
    `DROP TRIGGER ${MIRROR_REVERSE} ON "Alert"`,
    ...input.referencingForeignKeys.map(
      fk => `ALTER TABLE ${ident(fk.table)} DROP CONSTRAINT ${ident(fk.name)}`
    ),
    `ALTER TABLE "Alert" RENAME TO ${ident(PARTITIONED)}`,
    `ALTER INDEX ${ident(pkey)} RENAME TO ${ident(`${PARTITIONED}_pkey`)}`,
    ...renameIndexes('shadow'),
    `ALTER TABLE ${ident(UNPARTITIONED)} RENAME TO "Alert"`,
    `ALTER INDEX ${ident(`${UNPARTITIONED}_pkey`)} RENAME TO ${ident(pkey)}`,
    // The live definition is the composite one by now, so the original single-column key is restored.
    ...input.referencingForeignKeys.map(
      fk =>
        `ALTER TABLE ${ident(fk.table)} ADD CONSTRAINT ${ident(fk.name)} FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE NOT VALID`
    ),
  ];

  return { prepare, swap, finalize, rollback };
}

/**
 * One keyset batch of the copy. Rows are read FOR SHARE so a concurrent update or delete waits for the batch
 * to commit and its mirror trigger then sees the copied row. Params: $1 createdAt, $2 id, $3 limit.
 * Returns one row (count and last cursor), or none when the copy is complete.
 */
export const COPY_BATCH_SQL = `WITH src AS (
  SELECT * FROM "Alert" WHERE ("createdAt", "id") > ($1::timestamp(3), $2::text)
  ORDER BY "createdAt", "id" LIMIT $3::int FOR SHARE
), copied AS (
  INSERT INTO ${ident(PARTITIONED)} SELECT * FROM src ON CONFLICT DO NOTHING
)
SELECT (SELECT count(*) FROM src)::int AS rows, last."createdAt", last."id"
FROM (SELECT "createdAt", "id" FROM src ORDER BY "createdAt" DESC, "id" DESC LIMIT 1) last`;

export const COPY_START = { createdAt: '-infinity', id: '' } as const;

export interface MaintenancePlan {
  create: string[];
  detach: string[];
}

/**
 * Keeps `monthsAhead` future months created and detaches months that ended more than `retentionMonths` ago
 * (0 keeps everything). Detached tables are left in place for the operator to archive or drop.
 */
export function planMaintenance(input: {
  existing: readonly string[];
  now: Date;
  monthsAhead: number;
  retentionMonths: number;
}): MaintenancePlan {
  const existing = new Set(input.existing);
  const create = monthsBetween(input.now, addMonths(input.now, input.monthsAhead))
    .filter(month => !existing.has(partitionName(month)))
    .map(month => createPartitionSql('Alert', month));
  const cutoff = addMonths(input.now, -input.retentionMonths);
  const detach =
    input.retentionMonths > 0
      ? input.existing
          .filter(name => {
            const month = partitionMonth(name);
            return month !== null && addMonths(month, 1) <= cutoff;
          })
          .sort()
          .map(name => `ALTER TABLE "Alert" DETACH PARTITION ${ident(name)}`)
      : [];
  return { create, detach };
}
