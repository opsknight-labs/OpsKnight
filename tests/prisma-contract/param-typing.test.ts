import { afterAll, beforeAll, describe, it } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createContractClient, disconnectContractClients, requireEnv } from './support/client';
import { describeValue } from './support/describe';
import { outcome } from './support/classify';
import { goldenFile } from './support/golden';

const golden = goldenFile('param-typing');
const instant = new Date('2026-10-28T10:11:12.345Z');

let prisma: PrismaClient;
beforeAll(() => {
  prisma = createContractClient(requireEnv('CONTRACT_DATABASE_URL'));
});
afterAll(disconnectContractClients);

type Case = () => Prisma.Sql;

// Parameter shapes used across OpsKnight raw SQL (positional, untyped and cast).
const CASES: Record<string, Case> = {
  intSelect: () => Prisma.sql`SELECT ${5} AS v`,
  intArithmetic: () => Prisma.sql`SELECT ${5} + 1 AS v`,
  bigintSelect: () => Prisma.sql`SELECT ${BigInt('9007199254740993')} AS v`,
  bigintCast: () => Prisma.sql`SELECT ${BigInt('9007199254740993')}::bigint AS v`,
  floatSelect: () => Prisma.sql`SELECT ${1.5} AS v`,
  stringSelect: () => Prisma.sql`SELECT ${'text'} AS v`,
  stringConcat: () => Prisma.sql`SELECT ${'a'} || ${'b'} AS v`,
  booleanSelect: () => Prisma.sql`SELECT ${true} AS v`,
  booleanCase: () => Prisma.sql`SELECT CASE WHEN ${true} THEN 'y' ELSE 'n' END AS v`,
  nullSelect: () => Prisma.sql`SELECT ${null} AS v`,
  nullIsNull: () => Prisma.sql`SELECT ${null} IS NULL AS v`,
  nullCastIsNull: () => Prisma.sql`SELECT ${null}::text IS NULL AS v`,
  nullCoalesce: () => Prisma.sql`SELECT COALESCE(${null}, 'fallback') AS v`,
  dateSelect: () => Prisma.sql`SELECT ${instant} AS v`,
  dateCastTimestamptz: () => Prisma.sql`SELECT ${instant}::timestamptz AS v`,
  dateCastTimestamp: () => Prisma.sql`SELECT ${instant}::timestamp AS v`,
  dateCastDate: () => Prisma.sql`SELECT ${instant}::date AS v`,
  dateEpoch: () => Prisma.sql`SELECT EXTRACT(EPOCH FROM ${instant}::timestamptz) AS v`,
  dateCompareNow: () => Prisma.sql`SELECT ${instant} < now() AS v`,
  dateIntervalArithmetic: () => Prisma.sql`SELECT ${instant}::timestamptz + interval '1 hour' AS v`,
  bytesSelect: () => Prisma.sql`SELECT ${Buffer.from([1, 2, 255])} AS v`,
  bytesLength: () => Prisma.sql`SELECT length(${Buffer.from([1, 2, 255])}::bytea) AS v`,
  textArrayCast: () => Prisma.sql`SELECT ${['a', 'b']}::text[] AS v`,
  intArrayCast: () => Prisma.sql`SELECT ${[1, 2]}::int[] AS v`,
  anyArray: () => Prisma.sql`SELECT ${'a'} = ANY(${['a', 'b']}) AS v`,
  unnestOrdinality: () => Prisma.sql`
    SELECT array_agg(identity ORDER BY position) AS v
    FROM unnest(${['x', 'y']}::text[]) WITH ORDINALITY AS t(identity, position)`,
  jsonObjectCast: () => Prisma.sql`SELECT ${JSON.stringify({ a: 1, b: [true] })}::jsonb AS v`,
  jsonObjectParam: () => Prisma.sql`SELECT ${{ a: 1 }}::jsonb AS v`,
  jsonPathParam: () =>
    Prisma.sql`SELECT (${JSON.stringify({ a: { b: 7 } })}::jsonb #>> ${['a', 'b']}::text[]) AS v`,
  enumCast: () => Prisma.sql`SELECT ${'RESPONDER'}::"Role" AS v`,
  limitParam: () => Prisma.sql`SELECT x AS v FROM generate_series(1, 10) x ORDER BY x LIMIT ${2}`,
  joinValues: () => Prisma.sql`SELECT ARRAY[${Prisma.join([1, 2, 3])}]::int[] AS v`,
  joinInList: () => Prisma.sql`SELECT 2 IN (${Prisma.join([1, 2, 3])}) AS v`,
  nestedFragments: () => {
    const inner = Prisma.sql`x > ${1}`;
    const where = Prisma.sql`WHERE ${inner} AND x < ${4}`;
    return Prisma.sql`SELECT array_agg(x ORDER BY x) AS v FROM generate_series(1, 5) x ${where}`;
  },
  emptyFragment: () =>
    Prisma.sql`SELECT count(*) AS v FROM generate_series(1, 3) x ${Prisma.empty}`,
  rawIdentifier: () => Prisma.sql`SELECT ${Prisma.raw('7')} + ${1} AS v`,
};

describe('raw SQL parameter typing', () => {
  for (const [name, build] of Object.entries(CASES)) {
    it(name, async () => {
      golden.observe(
        `queryRaw.${name}`,
        await outcome(
          () => prisma.$queryRaw<Array<{ v: unknown }>>(build()),
          rows => rows.map(row => describeValue(row.v))
        )
      );
    });
  }

  it('binds positional $queryRawUnsafe parameters', async () => {
    golden.observe(
      'unsafe.castInts',
      await outcome(
        () => prisma.$queryRawUnsafe<Array<{ v: unknown }>>('SELECT $1::int + $2::int AS v', 1, 2),
        rows => describeValue(rows[0]?.v)
      )
    );
    golden.observe(
      'unsafe.untypedString',
      await outcome(
        () => prisma.$queryRawUnsafe<Array<{ v: unknown }>>('SELECT $1 AS v', 'x'),
        rows => describeValue(rows[0]?.v)
      )
    );
    golden.observe(
      'unsafe.dateParam',
      await outcome(
        () => prisma.$queryRawUnsafe<Array<{ v: unknown }>>('SELECT $1::timestamptz AS v', instant),
        rows => describeValue(rows[0]?.v)
      )
    );
    golden.observe(
      'unsafe.arrayParam',
      await outcome(
        () =>
          prisma.$queryRawUnsafe<Array<{ v: unknown }>>('SELECT cardinality($1::text[]) AS v', [
            'a',
            'b',
            'c',
          ]),
        rows => describeValue(rows[0]?.v)
      )
    );
  });
});
