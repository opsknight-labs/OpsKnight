/* eslint-disable security/detect-object-injection -- keys are fixed scenario names, never external input */
import { afterAll, beforeAll, describe, it } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createContractClient, disconnectContractClients, requireEnv } from './support/client';
import { describeValue } from './support/describe';
import { outcome } from './support/classify';
import { goldenFile } from './support/golden';

const golden = goldenFile('param-contexts');
const RUN = `contract-ctx-${process.pid}-${Date.now()}`;
const early = new Date('2026-10-28T08:00:00.000Z');
const late = new Date('2026-10-28T20:00:00.000Z');

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createContractClient(requireEnv('CONTRACT_DATABASE_URL'));
  await prisma.ingestionQuota.create({
    data: { key: `${RUN}-q`, tokens: 2.5, rate: 3, burst: 4, updatedAt: early, lastAllowed: true },
  });
  await prisma.user.create({
    data: { id: `${RUN}-u`, name: 'Ctx', email: `${RUN}@example.test`, createdAt: early },
  });
});

afterAll(async () => {
  await prisma.ingestionQuota.deleteMany({ where: { key: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: RUN } } });
  await disconnectContractClients();
});

/**
 * Parameter positions where PostgreSQL cannot infer a type from a column or cast. Prisma 5 bound
 * typed parameters (int8, numeric, bool, timestamptz); driver adapters send untyped values, so
 * these contexts are where application-visible behaviour could change.
 */
const CASES: Record<string, () => Prisma.Sql> = {
  jsonbBuildNumber: () => Prisma.sql`SELECT jsonb_build_object('n', ${5}, 'f', ${1.5}) AS v`,
  jsonbBuildBoolean: () => Prisma.sql`SELECT jsonb_build_object('b', ${true}) AS v`,
  jsonbBuildDate: () => Prisma.sql`SELECT jsonb_build_object('d', ${early}) AS v`,
  jsonbBuildString: () => Prisma.sql`SELECT jsonb_build_object('s', ${'x'}) AS v`,
  jsonbBuildNull: () => Prisma.sql`SELECT jsonb_build_object('z', ${null}::text) AS v`,
  toJsonbNumber: () => Prisma.sql`SELECT to_jsonb(${7}) AS v`,
  coalesceDateColumn: () => Prisma.sql`SELECT COALESCE(NULL::timestamptz, ${late}) AS v`,
  coalesceParamFirst: () =>
    Prisma.sql`SELECT COALESCE(${late}, "updatedAt") AS v FROM "IngestionQuota" WHERE key = ${`${RUN}-q`}`,
  greatestDateColumn: () =>
    Prisma.sql`SELECT GREATEST("updatedAt", ${late}) AS v FROM "IngestionQuota" WHERE key = ${`${RUN}-q`}`,
  greatestTimestampColumn: () =>
    Prisma.sql`SELECT GREATEST("createdAt", ${late}) AS v FROM "User" WHERE id = ${`${RUN}-u`}`,
  intervalFromParam: () =>
    Prisma.sql`SELECT ${late}::timestamptz - "updatedAt" > interval '1 hour' AS v FROM "IngestionQuota" WHERE key = ${`${RUN}-q`}`,
  makeIntervalMs: () =>
    Prisma.sql`SELECT NOW() - make_interval(secs => ${90000} / 1000.0) < NOW() AS v`,
  intervalMultiply: () => Prisma.sql`SELECT interval '1 millisecond' * ${2500} AS v`,
  numericArithmeticColumn: () =>
    Prisma.sql`SELECT tokens + ${1.25} AS v FROM "IngestionQuota" WHERE key = ${`${RUN}-q`}`,
  intArithmeticColumn: () =>
    Prisma.sql`SELECT rate + ${2} AS v FROM "IngestionQuota" WHERE key = ${`${RUN}-q`}`,
  intDivisionParams: () => Prisma.sql`SELECT ${7} / ${2} AS v`,
  leastParams: () => Prisma.sql`SELECT LEAST(${3}, ${9}) AS v`,
  caseParamResult: () => Prisma.sql`SELECT CASE WHEN true THEN ${42} ELSE 0 END AS v`,
  valuesListTyped: () => Prisma.sql`
    SELECT count(*) AS v
    FROM (VALUES (${`${RUN}-q`}, ${3}), (${'other'}, ${4})) AS v(k, r)
    JOIN "IngestionQuota" q ON q.key = v.k AND q.rate = v.r`,
  valuesListDates: () => Prisma.sql`
    SELECT count(*) AS v
    FROM (VALUES (${early}), (${late})) AS v(at)
    WHERE v.at::timestamptz >= ${early}`,
  valuesListDateCompareUncast: () => Prisma.sql`
    SELECT count(*) AS v FROM "IngestionQuota" q
    JOIN (VALUES (${early})) AS v(at) ON q."updatedAt" = v.at::timestamptz
    WHERE q.key = ${`${RUN}-q`}`,
  unnestNumberArray: () =>
    Prisma.sql`SELECT array_agg(x ORDER BY x) AS v FROM unnest(${[3, 1, 2]}::int[]) AS x`,
  unnestDateArray: () =>
    Prisma.sql`SELECT array_agg(x ORDER BY x) AS v FROM unnest(${[late, early]}::timestamptz[]) AS x`,
  arrayLengthParam: () => Prisma.sql`SELECT cardinality(${['a', 'b']}::text[]) AS v`,
  insertSelectNumber: () => Prisma.sql`
    WITH updated AS (
      UPDATE "IngestionQuota" SET tokens = ${9.75}, rate = ${11}, "updatedAt" = ${late}
      WHERE key = ${`${RUN}-q`} RETURNING tokens, rate, "updatedAt"
    ) SELECT * FROM updated`,
  limitOffsetParams: () =>
    Prisma.sql`SELECT array_agg(x) AS v FROM (SELECT x FROM generate_series(1, 10) x ORDER BY x LIMIT ${3} OFFSET ${2}) s`,
  stringConcatNumber: () => Prisma.sql`SELECT 'n=' || ${5} AS v`,
  likeParam: () => Prisma.sql`SELECT 'abc' LIKE ${'a%'} AS v`,
  isDistinctFromNull: () =>
    Prisma.sql`SELECT count(*) AS v FROM "User" WHERE id = ${`${RUN}-u`} AND "department" IS NOT DISTINCT FROM ${null}`,
  jsonbContainsParam: () =>
    Prisma.sql`SELECT '{"a":1,"b":2}'::jsonb @> ${JSON.stringify({ a: 1 })}::jsonb AS v`,
  jsonbPathText: () => Prisma.sql`SELECT ('{"a":{"b":7}}'::jsonb ->> ${'a'}) AS v`,
  bigintColumnCompare: () =>
    Prisma.sql`SELECT count(*) AS v FROM "IngestionQuota" WHERE key = ${`${RUN}-q`} AND "policyRevision" >= ${BigInt(0)}`,
  booleanColumnCompare: () =>
    Prisma.sql`SELECT count(*) AS v FROM "IngestionQuota" WHERE key = ${`${RUN}-q`} AND "lastAllowed" = ${true}`,
  timestampColumnUncast: () =>
    Prisma.sql`SELECT count(*) AS v FROM "User" WHERE id = ${`${RUN}-u`} AND "createdAt" < ${late}`,
  nowMinusParamMs: () =>
    Prisma.sql`SELECT NOW() - (${60000} * interval '1 millisecond') < NOW() AS v`,
  extractEpochParam: () => Prisma.sql`SELECT floor(EXTRACT(EPOCH FROM ${late}::timestamptz)) AS v`,
  dateTruncParam: () => Prisma.sql`SELECT date_trunc('hour', ${late}::timestamptz) AS v`,
  generateSeriesDates: () =>
    Prisma.sql`SELECT count(*) AS v FROM generate_series(${early}::timestamptz, ${late}::timestamptz, interval '1 hour')`,
};

describe('ambiguous parameter contexts', () => {
  for (const [name, build] of Object.entries(CASES)) {
    it(name, async () => {
      golden.observe(
        name,
        await outcome(
          () => prisma.$queryRaw<Array<Record<string, unknown>>>(build()),
          rows =>
            rows.map(row =>
              Object.fromEntries(
                Object.keys(row)
                  .sort()
                  .map(k => [k, describeValue(row[k])])
              )
            )
        )
      );
    });
  }
});
