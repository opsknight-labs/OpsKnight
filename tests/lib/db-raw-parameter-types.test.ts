import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  castPlaceholders,
  prisma5ParameterCast,
  rawSqlTextFromCall,
  registerRawSql,
  withPrisma5ParameterTypes,
} from '@/lib/db/raw-parameter-types';

const casts = (entries: Array<[number, string]>) => new Map(entries);

describe('castPlaceholders', () => {
  it('casts every occurrence of the selected placeholders', () => {
    expect(castPlaceholders('SELECT $1, $2, $1 + 1', casts([[1, 'int8']]))).toBe(
      'SELECT ($1::int8), $2, ($1::int8) + 1'
    );
  });

  it('distinguishes $1 from $10 and $11', () => {
    expect(
      castPlaceholders(
        'VALUES ($1, $10, $11)',
        casts([
          [1, 'int8'],
          [11, 'bool'],
        ])
      )
    ).toBe('VALUES (($1::int8), $10, ($11::bool))');
  });

  it('keeps existing casts working by casting inside parentheses', () => {
    expect(
      castPlaceholders(
        'SELECT $1::"Role", $2::int[]',
        casts([
          [1, 'text'],
          [2, 'text[]'],
        ])
      )
    ).toBe('SELECT ($1::text)::"Role", ($2::text[])::int[]');
  });

  it('never rewrites inside literals, identifiers, comments or dollar-quoted bodies', () => {
    const sql = [
      "SELECT '$1', 'it''s $1', E'\\'$1', \"col$1\", $1",
      '-- $1 in a comment',
      '/* $1 /* nested $1 */ still $1 */',
      'DO $$ BEGIN PERFORM $1; END $$',
      '$tag$ $1 $tag$',
      '$1',
    ].join('\n');
    expect(castPlaceholders(sql, casts([[1, 'int8']]))).toBe(
      [
        "SELECT '$1', 'it''s $1', E'\\'$1', \"col$1\", ($1::int8)",
        '-- $1 in a comment',
        '/* $1 /* nested $1 */ still $1 */',
        'DO $$ BEGIN PERFORM $1; END $$',
        '$tag$ $1 $tag$',
        '($1::int8)',
      ].join('\n')
    );
  });

  it('ignores dollar signs that are part of identifiers', () => {
    expect(castPlaceholders('SELECT a$1, $1', casts([[1, 'text']]))).toBe('SELECT a$1, ($1::text)');
  });

  it('produces SQL that remains valid in syntax-sensitive positions', () => {
    expect(
      castPlaceholders(
        'SELECT * FROM t LIMIT $1 OFFSET $2 FETCH FIRST $3 ROWS ONLY',
        casts([
          [1, 'int8'],
          [2, 'int8'],
          [3, 'int8'],
        ])
      )
    ).toBe('SELECT * FROM t LIMIT ($1::int8) OFFSET ($2::int8) FETCH FIRST ($3::int8) ROWS ONLY');
  });
});

describe('Prisma 5 parameter types', () => {
  const scalar = (scalarType: string) => ({ scalarType, arity: 'scalar' }) as never;
  const list = (scalarType: string) => ({ scalarType, arity: 'list' }) as never;

  it('matches the types Prisma 5.22 bound (measured with pg_typeof)', () => {
    expect(prisma5ParameterCast(scalar('decimal'), 5)).toBe('int8');
    expect(prisma5ParameterCast(scalar('decimal'), -0)).toBe('int8');
    expect(prisma5ParameterCast(scalar('decimal'), 3_000_000_000)).toBe('int8');
    expect(prisma5ParameterCast(scalar('decimal'), 1.5)).toBe('numeric');
    expect(prisma5ParameterCast(scalar('decimal'), '1.25')).toBe('numeric');
    expect(prisma5ParameterCast(scalar('decimal'), Number.NaN)).toBeUndefined();
    expect(prisma5ParameterCast(scalar('bigint'), '9007199254740993')).toBe('int8');
    expect(prisma5ParameterCast(scalar('unknown'), true)).toBe('bool');
    expect(prisma5ParameterCast(scalar('string'), 'x')).toBe('text');
    expect(prisma5ParameterCast(scalar('datetime'), '2026-10-28T00:00:00.000Z')).toBe(
      'timestamptz'
    );
    expect(prisma5ParameterCast(scalar('bytes'), 'AQI=')).toBe('bytea');
    expect(prisma5ParameterCast(scalar('json'), '{"a":1}')).toBe('jsonb');
    expect(prisma5ParameterCast(scalar('string'), null)).toBeUndefined();
  });

  it('types string, integer and boolean arrays as text[] and leaves others untyped', () => {
    expect(prisma5ParameterCast(list('string'), ['a', 'b'])).toBe('text[]');
    expect(prisma5ParameterCast(list('decimal'), [1, 2])).toBe('text[]');
    expect(prisma5ParameterCast(list('unknown'), [])).toBe('text[]');
    expect(prisma5ParameterCast(list('decimal'), [1.5, 2])).toBeUndefined();
    expect(prisma5ParameterCast(list('datetime'), ['2026-10-28T00:00:00Z'])).toBeUndefined();
  });

  it('rewrites only statements registered as application raw SQL', () => {
    const query = {
      sql: 'SELECT $1 AS unregistered_v',
      args: [5],
      argTypes: [scalar('decimal')],
    };
    expect(withPrisma5ParameterTypes(query)).toBe(query);
    registerRawSql(query.sql);
    expect(withPrisma5ParameterTypes(query).sql).toBe('SELECT ($1::int8) AS unregistered_v');
  });
});

describe('rawSqlTextFromCall', () => {
  it('derives the PostgreSQL text Prisma sends for each raw call form', () => {
    const inner = Prisma.sql`x > ${1}`;
    const nested = Prisma.sql`SELECT * FROM t WHERE ${inner} AND y IN (${Prisma.join([2, 3])})`;
    expect(rawSqlTextFromCall('$queryRaw', [nested])).toBe(
      'SELECT * FROM t WHERE x > $1 AND y IN ($2,$3)'
    );
    const strings = Object.assign(['SELECT ', ' + ', ''], { raw: ['SELECT ', ' + ', ''] });
    expect(rawSqlTextFromCall('$executeRaw', [strings, 1, 2])).toBe('SELECT $1 + $2');
    expect(rawSqlTextFromCall('$queryRawUnsafe', ['SELECT $1', 5])).toBe('SELECT $1');
    expect(rawSqlTextFromCall('$queryRaw', [42])).toBeUndefined();
  });
});
