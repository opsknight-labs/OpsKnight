import { afterAll, describe, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createContractClient, disconnectContractClients, requireEnv } from './support/client';
import { describeValue } from './support/describe';
import { outcome } from './support/classify';
import { goldenFile } from './support/golden';

const golden = goldenFile('timezone');
const RUN = `contract-tz-${process.pid}-${Date.now()}`;

// 23:30 UTC is already the next calendar day in Asia/Kolkata (+05:30), which exposes
// any parameter or decoding path that silently uses the session time zone.
const instant = new Date('2026-10-28T23:30:00.123Z');
const before = new Date('2026-10-28T23:29:59.000Z');
const after = new Date('2026-10-28T23:30:01.000Z');
const day = new Date('2026-10-28T00:00:00.000Z');

afterAll(disconnectContractClients);

async function scenario(prisma: PrismaClient) {
  const userId = `${RUN}-user`;
  const key = `${RUN}-quota`;
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.ingestionQuota.deleteMany({ where: { key } });
  await prisma.incidentSlaLegacyCapture.deleteMany({ where: { day } });
  await prisma.user.create({
    data: { id: userId, name: 'TZ', email: `${RUN}@example.test`, createdAt: instant },
  });
  await prisma.ingestionQuota.create({
    data: { key, tokens: 1, rate: 1, burst: 1, updatedAt: instant, lastAllowed: true },
  });
  await prisma.incidentSlaLegacyCapture.create({ data: { day, lastSeenAt: instant } });

  try {
    const results: Record<string, unknown> = {};
    // timestamp(3) without time zone column (Prisma DateTime default)
    results.modelReadTimestamp = describeValue(
      (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).createdAt
    );
    results.modelFilterTimestamp = await prisma.user.count({
      where: { id: userId, createdAt: { gte: before, lt: after } },
    });
    results.rawReadTimestamp = describeValue(
      (
        await prisma.$queryRaw<Array<{ v: unknown }>>`
          SELECT "createdAt" AS v FROM "User" WHERE id = ${userId}`
      )[0]?.v
    );
    results.rawFilterTimestampUncast = Number(
      (
        await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n FROM "User"
          WHERE id = ${userId} AND "createdAt" >= ${before} AND "createdAt" < ${after}`
      )[0]?.n
    );
    results.rawFilterTimestampCastTz = Number(
      (
        await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n FROM "User"
          WHERE id = ${userId} AND "createdAt" >= ${before}::timestamptz AND "createdAt" < ${after}::timestamptz`
      )[0]?.n
    );
    // timestamptz(3) column
    results.modelReadTimestamptz = describeValue(
      (await prisma.ingestionQuota.findUniqueOrThrow({ where: { key } })).updatedAt
    );
    results.modelFilterTimestamptz = await prisma.ingestionQuota.count({
      where: { key, updatedAt: { gte: before, lt: after } },
    });
    results.rawFilterTimestamptzUncast = Number(
      (
        await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n FROM "IngestionQuota"
          WHERE key = ${key} AND "updatedAt" >= ${before} AND "updatedAt" < ${after}`
      )[0]?.n
    );
    results.rawWriteTimestamptz = await outcome(async () => {
      await prisma.$executeRaw`UPDATE "IngestionQuota" SET "updatedAt" = ${after} WHERE key = ${key}`;
      return (await prisma.ingestionQuota.findUniqueOrThrow({ where: { key } })).updatedAt;
    }, describeValue);
    results.rawWriteTimestampColumn = await outcome(async () => {
      await prisma.$executeRaw`UPDATE "User" SET "createdAt" = ${after} WHERE id = ${userId}`;
      return (await prisma.user.findUniqueOrThrow({ where: { id: userId } })).createdAt;
    }, describeValue);
    // date column
    results.modelReadDate = describeValue(
      (await prisma.incidentSlaLegacyCapture.findUniqueOrThrow({ where: { day } })).day
    );
    results.rawDateFromInstantParam = describeValue(
      (await prisma.$queryRaw<Array<{ v: unknown }>>`SELECT (${instant})::date AS v`)[0]?.v
    );
    results.rawDateFilterByDay = Number(
      (
        await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT count(*) AS n FROM "IncidentSlaLegacyCapture" WHERE day = ${day}::date`
      )[0]?.n
    );
    results.rawNowIsRecent = (
      await prisma.$queryRaw<Array<{ ok: boolean }>>`
        SELECT abs(EXTRACT(EPOCH FROM (now() - ${new Date()}::timestamptz))) < 60 AS ok`
    )[0]?.ok;
    results.rawDateTruncDay = describeValue(
      (
        await prisma.$queryRaw<Array<{ v: unknown }>>`
          SELECT date_trunc('day', ${instant}::timestamptz) AS v`
      )[0]?.v
    );
    return results;
  } finally {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.ingestionQuota.deleteMany({ where: { key } });
    await prisma.incidentSlaLegacyCapture.deleteMany({ where: { day } });
  }
}

describe('date/time handling is independent of the server time zone', () => {
  it('UTC server', async () => {
    golden.observe(
      'utc',
      await scenario(createContractClient(requireEnv('CONTRACT_DATABASE_URL')))
    );
  });

  it('UTC server through PgBouncer', async () => {
    golden.observe(
      'utcPgbouncer',
      await scenario(createContractClient(requireEnv('CONTRACT_PGBOUNCER_URL')))
    );
  });

  it('Asia/Kolkata server through PgBouncer', async () => {
    golden.observe(
      'asiaKolkataPgbouncer',
      await scenario(createContractClient(requireEnv('CONTRACT_PGBOUNCER_TZ_URL')))
    );
  });

  it('Asia/Kolkata server', async () => {
    golden.observe(
      'asiaKolkata',
      await scenario(createContractClient(requireEnv('CONTRACT_TZ_DATABASE_URL')))
    );
  });
});
