import { describe, it, expect } from 'vitest';
import {
  incidentEventWhereFor,
  incidentEventSqlPredicate,
} from '@/lib/incident-event-classifier';

describe('incidentEventWhereFor (Prisma fragment)', () => {
  it('matches both typed rows and untyped legacy rows', () => {
    const where = incidentEventWhereFor('ESCALATED');

    // Shape: OR of [type match, type-null + message substring].
    // Asserting structurally rather than executing it (no DB here).
    expect(where).toHaveProperty('OR');
    const branches = (where as { OR: unknown[] }).OR;
    expect(branches).toHaveLength(2);

    // First branch: strict typed match.
    expect(branches[0]).toEqual({ type: 'ESCALATED' });

    // Second branch: pre-backfill rows — type=null + message ILIKE legacy substring.
    expect(branches[1]).toMatchObject({
      AND: [
        { type: null },
        { message: { contains: 'escalated to', mode: 'insensitive' } },
      ],
    });
  });

  it('produces the right legacy substring for each kind', () => {
    const cases: Array<[Parameters<typeof incidentEventWhereFor>[0], string]> = [
      ['ACKNOWLEDGED', 'acknowledged'],
      ['ESCALATED', 'escalated to'],
      ['REOPENED', 'reopen'],
      ['AUTO_RESOLVED', 'auto-resolved'],
    ];
    for (const [kind, substring] of cases) {
      const where = incidentEventWhereFor(kind) as { OR: Array<Record<string, unknown>> };
      const fallback = where.OR[1] as { AND: Array<Record<string, unknown>> };
      const messagePredicate = fallback.AND[1] as { message: { contains: string } };
      expect(messagePredicate.message.contains).toBe(substring);
    }
  });
});

describe('incidentEventSqlPredicate (raw-SQL fragment)', () => {
  it('parameterizes the legacy substring (never interpolates)', () => {
    const sql = incidentEventSqlPredicate('REOPENED', 'e');
    // Prisma.Sql has a `strings`-style internal shape; we don't depend
    // on it here — instead we check via .text and .values which are
    // exposed by the Prisma Sql helper.
    const inspect = sql as unknown as { values: unknown[] };
    expect(Array.isArray(inspect.values)).toBe(true);
    // Two values: the enum tag and the substring pattern.
    const stringValues = inspect.values.filter((v): v is string => typeof v === 'string');
    expect(stringValues).toContain('REOPENED');
    expect(stringValues).toContain('%reopen%');
  });

  it('uses the provided table alias', () => {
    const aliased = incidentEventSqlPredicate('ACKNOWLEDGED', 'ev');
    const inspect = aliased as unknown as { sql?: string; text?: string };
    const rendered = inspect.sql ?? inspect.text ?? '';
    expect(rendered).toContain('ev."type"');
    expect(rendered).toContain('ev."message"');
  });
});
