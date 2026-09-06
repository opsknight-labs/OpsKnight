import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';

/**
 * Incident-event classification for the SLA metrics pipeline.
 *
 * History: classification used to be "message ILIKE '%reopen%'" etc.
 * That's locale-fragile (wording changes break it), can match comments
 * that quote the word, and double-counts when multiple patterns match
 * the same row. A migration added a strongly-typed `IncidentEvent.type`
 * column.
 *
 * Rolling-deploy contract:
 *   - Old code still writes events with `type = NULL` and a free-form
 *     message. Those rows are matched by the ILIKE fallback.
 *   - New code writes events with `type` set to one of the
 *     `IncidentEventType` enum values. The new readers prefer the
 *     typed match.
 *   - After backfill + a follow-up release flips the readers to
 *     typed-only, the ILIKE fallback can be deleted.
 *
 * Both Prisma `where`-clause builders and raw-SQL fragments are
 * provided so every classifier call site stays in lockstep.
 */

export type ClassifiedEventKind = 'ACKNOWLEDGED' | 'ESCALATED' | 'REOPENED' | 'AUTO_RESOLVED';

interface ClassifierSpec {
  /** Enum value written by new writers. */
  type: ClassifiedEventKind;
  /** Legacy substring matched by `ILIKE '%<value>%'`. */
  legacySubstring: string;
}

const SPECS: Record<ClassifiedEventKind, ClassifierSpec> = {
  ACKNOWLEDGED: { type: 'ACKNOWLEDGED', legacySubstring: 'acknowledged' },
  ESCALATED: { type: 'ESCALATED', legacySubstring: 'escalated to' },
  REOPENED: { type: 'REOPENED', legacySubstring: 'reopen' },
  AUTO_RESOLVED: { type: 'AUTO_RESOLVED', legacySubstring: 'auto-resolved' },
};

/**
 * Prisma `where`-clause fragment for one classified event kind.
 * Matches typed-first; falls back to message-substring for rows where
 * `type IS NULL` (pre-migration / pre-backfill data).
 *
 * Returns a `Prisma.IncidentEventWhereInput`-shaped object so callers
 * can splice it into a larger `where` clause directly.
 */
export function incidentEventWhereFor(
  kind: ClassifiedEventKind
): PrismaTypes.IncidentEventWhereInput {
  const spec = SPECS[kind];
  if (kind === 'ACKNOWLEDGED') {
    return {
      OR: [
        { type: spec.type },
        {
          AND: [
            { type: null },
            { message: { contains: spec.legacySubstring, mode: 'insensitive' } },
            { NOT: { message: { contains: 'unacknowledged', mode: 'insensitive' } } },
          ],
        },
      ],
    };
  }
  if (kind === 'REOPENED') {
    return {
      OR: [
        { type: spec.type },
        {
          AND: [
            { type: null },
            { message: { contains: spec.legacySubstring, mode: 'insensitive' } },
            { NOT: { message: { contains: 'do not reopen', mode: 'insensitive' } } },
          ],
        },
      ],
    };
  }
  if (kind === 'AUTO_RESOLVED') {
    return {
      OR: [
        { type: spec.type },
        {
          AND: [
            { type: null },
            { message: { contains: spec.legacySubstring, mode: 'insensitive' } },
            { NOT: { message: { contains: 'not auto-resolved', mode: 'insensitive' } } },
          ],
        },
      ],
    };
  }
  return {
    OR: [
      { type: spec.type },
      // Pre-backfill rows: type is NULL. Match on legacy substring.
      // After full backfill this branch becomes unreachable and can
      // be dropped by a follow-up release.
      {
        AND: [{ type: null }, { message: { contains: spec.legacySubstring, mode: 'insensitive' } }],
      },
    ],
  };
}

/**
 * Raw-SQL boolean expression for one classified event kind, scoped to
 * the given event-table alias (typically `e`).
 *
 * Usage:
 *   ```ts
 *   const escalated = incidentEventSqlPredicate('ESCALATED', 'e');
 *   prisma.$queryRaw`SELECT COUNT(*) FILTER (WHERE ${escalated}) ...`
 *   ```
 *
 * Returns a `Prisma.Sql` parenthesized expression suitable for
 * substitution inside a larger raw query. The legacy substring is
 * passed as a parameter (never interpolated) so the call remains
 * SQL-injection safe.
 */
export function incidentEventSqlPredicate(
  kind: ClassifiedEventKind,
  tableAlias: string = 'e'
): Prisma.Sql {
  const spec = SPECS[kind];
  // `Prisma.raw(...)` is safe here: tableAlias is a fixed string
  // controlled by call sites, never user input. The legacy pattern
  // is parameterized.
  const typeCol = Prisma.raw(`${tableAlias}."type"`);
  const msgCol = Prisma.raw(`${tableAlias}."message"`);

  if (kind === 'ACKNOWLEDGED') {
    return Prisma.sql`(${typeCol} = ${spec.type}::"IncidentEventType" OR (${typeCol} IS NULL AND ${msgCol} ILIKE ${'%' + spec.legacySubstring + '%'} AND ${msgCol} NOT ILIKE '%unacknowledged%'))`;
  }
  if (kind === 'REOPENED') {
    return Prisma.sql`(${typeCol} = ${spec.type}::"IncidentEventType" OR (${typeCol} IS NULL AND ${msgCol} ILIKE ${'%' + spec.legacySubstring + '%'} AND ${msgCol} NOT ILIKE '%do not reopen%'))`;
  }
  if (kind === 'AUTO_RESOLVED') {
    return Prisma.sql`(${typeCol} = ${spec.type}::"IncidentEventType" OR (${typeCol} IS NULL AND ${msgCol} ILIKE ${'%' + spec.legacySubstring + '%'} AND ${msgCol} NOT ILIKE '%not auto-resolved%'))`;
  }

  return Prisma.sql`(${typeCol} = ${spec.type}::"IncidentEventType" OR (${typeCol} IS NULL AND ${msgCol} ILIKE ${'%' + spec.legacySubstring + '%'}))`;
}
