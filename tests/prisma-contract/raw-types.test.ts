/* eslint-disable security/detect-object-injection -- keys are fixed scenario names, array indices or test-owned object keys, never external input */
import { afterAll, beforeAll, describe, it } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createContractClient, disconnectContractClients, requireEnv } from './support/client';
import { describeRow, describeValue } from './support/describe';
import { outcome } from './support/classify';
import { goldenFile } from './support/golden';

const golden = goldenFile('raw-types');

// Every PostgreSQL result type OpsKnight raw SQL produces, decoded in isolation.
const EXPRESSIONS: Record<string, string> = {
  int2: `1::int2`,
  int4: `2147483647::int4`,
  int8: `9007199254740993::int8`,
  count: `(SELECT count(*) FROM generate_series(1, 3))`,
  sumInt4: `(SELECT sum(x) FROM generate_series(1, 3) x)`,
  sumInt8: `(SELECT sum(x::int8) FROM generate_series(1, 3) x)`,
  avgInt: `(SELECT avg(x) FROM generate_series(1, 4) x)`,
  numeric: `12345.6789::numeric(12, 4)`,
  numericBig: `123456789012345678901234567890.123::numeric`,
  float4: `1.5::float4`,
  float8: `0.1::float8`,
  percentile: `(SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY x) FROM generate_series(1, 4) x)`,
  extractEpoch: `EXTRACT(EPOCH FROM interval '90 seconds')`,
  roundNumeric: `round(2.5::numeric, 0)`,
  bool: `true`,
  text: `'héllo'::text`,
  varchar: `'abc'::varchar(10)`,
  char: `'ab'::char(3)`,
  name: `'pg'::name`,
  uuid: `'6f1e2c34-8b7a-4c1d-9e2f-0a1b2c3d4e5f'::uuid`,
  date: `'2026-10-28'::date`,
  time: `'13:14:15.123'::time`,
  timetz: `'13:14:15+05:30'::timetz`,
  timestamp: `'2026-10-28 13:14:15.123'::timestamp`,
  timestamp3: `'2026-10-28 13:14:15.123456'::timestamp(3)`,
  timestamptz: `'2026-10-28 13:14:15.123+05:30'::timestamptz`,
  interval: `interval '1 day 2 hours'`,
  json: `'{"a":1,"b":[true,null,"x"]}'::json`,
  jsonb: `'{"big":12345678901234567890,"n":1.5}'::jsonb`,
  jsonbNullLiteral: `'null'::jsonb`,
  jsonbArray: `'[1,"two",{"three":3}]'::jsonb`,
  jsonbAgg: `(SELECT jsonb_agg(x) FROM generate_series(1, 2) x)`,
  textArray: `ARRAY['a', 'b,c', NULL]::text[]`,
  int4Array: `ARRAY[1, 2, 3]::int4[]`,
  int8Array: `ARRAY[1, 9007199254740993]::int8[]`,
  uuidArray: `ARRAY['6f1e2c34-8b7a-4c1d-9e2f-0a1b2c3d4e5f']::uuid[]`,
  timestamptzArray: `ARRAY['2026-10-28 00:00:00+00']::timestamptz[]`,
  jsonbArrayType: `ARRAY['{"a":1}']::jsonb[]`,
  bytea: `'\\xdeadbeef'::bytea`,
  byteaEmpty: `''::bytea`,
  enumValue: `'ADMIN'::"Role"`,
  enumArray: `ARRAY['ADMIN', 'USER']::"Role"[]`,
  money: `12.34::money`,
  inet: `'10.0.0.1'::inet`,
  oid: `1::oid`,
  nullInt: `NULL::int4`,
  nullText: `NULL::text`,
  nullUntyped: `NULL`,
  voidPgSleep: `pg_sleep(0)`,
  advisoryVoid: `pg_advisory_xact_lock(42)`,
  advisoryVoidText: `pg_advisory_xact_lock(43)::text`,
  tryAdvisory: `pg_try_advisory_xact_lock(44)`,
  hashTextExtended: `hashtextextended('abc', 0)`,
  generatedTextLiteral: `'literal'`,
  integerLiteral: `42`,
  decimalLiteral: `4.2`,
};

let prisma: PrismaClient;

beforeAll(() => {
  prisma = createContractClient(requireEnv('CONTRACT_DATABASE_URL'));
});
afterAll(disconnectContractClients);

describe('raw SQL result decoding', () => {
  for (const [name, expression] of Object.entries(EXPRESSIONS)) {
    it(`decodes ${name}`, async () => {
      golden.observe(
        `queryRawUnsafe.${name}`,
        await outcome(
          () => prisma.$queryRawUnsafe<Array<{ v: unknown }>>(`SELECT ${expression} AS v`),
          rows => describeValue(rows[0]?.v)
        )
      );
    });
  }

  it('decodes the same expressions through tagged templates inside a transaction', async () => {
    const results: Record<string, unknown> = {};
    for (const [name, expression] of Object.entries(EXPRESSIONS)) {
      results[name] = await outcome(
        () =>
          prisma.$transaction(
            tx => tx.$queryRaw<Array<{ v: unknown }>>`SELECT ${Prisma.raw(expression)} AS v`
          ),
        rows => describeValue(rows[0]?.v)
      );
    }
    golden.observe('taggedTemplateInTransaction', results);
  });

  it('decodes real OpsKnight rows through raw SQL and the model API', async () => {
    const key = `contract-raw-types-${Date.now()}`;
    const day = new Date('2026-10-27T00:00:00.000Z');
    await prisma.ingestionQuota.create({
      data: {
        key,
        tokens: 12.75,
        rate: 5,
        burst: 10,
        updatedAt: new Date('2026-10-28T10:11:12.345Z'),
        lastAllowed: true,
        policyRevision: BigInt('9007199254740993'),
      },
    });
    await prisma.incidentSlaLegacyCapture.upsert({
      where: { day },
      create: { day, count: BigInt(5), lastSeenAt: new Date('2026-10-28T01:02:03.456Z') },
      update: { count: BigInt(5), lastSeenAt: new Date('2026-10-28T01:02:03.456Z') },
    });
    try {
      const rawQuota = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM "IngestionQuota" WHERE key = ${key}`;
      const modelQuota = await prisma.ingestionQuota.findUniqueOrThrow({ where: { key } });
      const rawCapture = await prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT * FROM "IncidentSlaLegacyCapture" WHERE day = ${day}::date`;
      const modelCapture = await prisma.incidentSlaLegacyCapture.findUniqueOrThrow({
        where: { day },
      });
      golden.observe('rows.ingestionQuota.raw', describeRow({ ...rawQuota[0], key: 'K' }));
      golden.observe('rows.ingestionQuota.model', describeRow({ ...modelQuota, key: 'K' }));
      golden.observe('rows.legacyCapture.raw', describeRow(rawCapture[0]));
      golden.observe('rows.legacyCapture.model', describeRow(modelCapture));
    } finally {
      await prisma.ingestionQuota.delete({ where: { key } });
      await prisma.incidentSlaLegacyCapture.delete({ where: { day } });
    }
  });

  it('reports affected row counts from $executeRaw', async () => {
    golden.observe(
      'executeRaw.count',
      await outcome(
        () => prisma.$executeRaw`UPDATE "IngestionBudget" SET shard = shard WHERE shard < 0`,
        describeValue
      )
    );
    golden.observe(
      'executeRaw.multiStatement',
      await outcome(() => prisma.$executeRawUnsafe('SELECT 1; SELECT 2'), describeValue)
    );
  });
});
