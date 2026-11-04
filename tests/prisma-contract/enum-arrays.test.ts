import { afterAll, beforeAll, describe, it } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createContractClient, disconnectContractClients, requireEnv } from './support/client';
import { describeValue } from './support/describe';
import { outcome } from './support/classify';
import { goldenFile } from './support/golden';

const golden = goldenFile('enum-arrays');
const RUN = `contract-enum-${process.pid}-${Date.now()}`;

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createContractClient(requireEnv('CONTRACT_DATABASE_URL'));
  await prisma.service.createMany({
    data: [
      { id: `${RUN}-a`, name: `${RUN}-a`, serviceNotificationChannels: ['EMAIL', 'SLACK'] },
      { id: `${RUN}-b`, name: `${RUN}-b`, serviceNotificationChannels: [] },
      { id: `${RUN}-c`, name: `${RUN}-c`, serviceNotificationChannels: ['MICROSOFT_TEAMS'] },
    ],
  });
});

afterAll(async () => {
  await prisma.service.deleteMany({ where: { id: { startsWith: RUN } } });
  await disconnectContractClients();
});

describe('enum list columns (NotificationChannel[])', () => {
  it('reads and filters through the model API', async () => {
    const rows = await prisma.service.findMany({
      where: { id: { startsWith: RUN } },
      orderBy: { id: 'asc' },
      select: { serviceNotificationChannels: true },
    });
    golden.observe(
      'model.read',
      rows.map(row => describeValue(row.serviceNotificationChannels))
    );
    golden.observe(
      'model.filterHas',
      await prisma.service.count({
        where: { id: { startsWith: RUN }, serviceNotificationChannels: { has: 'SLACK' } },
      })
    );
    golden.observe(
      'model.filterHasSome',
      await prisma.service.count({
        where: {
          id: { startsWith: RUN },
          serviceNotificationChannels: { hasSome: ['MICROSOFT_TEAMS', 'EMAIL'] },
        },
      })
    );
    golden.observe(
      'model.filterIsEmpty',
      await prisma.service.count({
        where: { id: { startsWith: RUN }, serviceNotificationChannels: { isEmpty: true } },
      })
    );
  });

  it('updates through the model API', async () => {
    await prisma.service.update({
      where: { id: `${RUN}-b` },
      data: { serviceNotificationChannels: { push: 'PUSH' } },
    });
    const row = await prisma.service.findUniqueOrThrow({
      where: { id: `${RUN}-b` },
      select: { serviceNotificationChannels: true },
    });
    golden.observe('model.push', describeValue(row.serviceNotificationChannels));
  });

  it('reads through raw SQL', async () => {
    golden.observe(
      'raw.column',
      await outcome(
        () =>
          prisma.$queryRaw<Array<{ channels: unknown }>>`
            SELECT "serviceNotificationChannels" AS channels FROM "Service"
            WHERE id LIKE ${`${RUN}-%`} ORDER BY id`,
        rows => rows.map(row => describeValue(row.channels))
      )
    );
    golden.observe(
      'raw.unnestDistinct',
      await outcome(
        () =>
          prisma.$queryRaw<Array<{ channels: unknown }>>`
            SELECT array_agg(DISTINCT c ORDER BY c) AS channels
            FROM "Service", unnest("serviceNotificationChannels") AS c
            WHERE id LIKE ${`${RUN}-%`}`,
        rows => describeValue(rows[0]?.channels)
      )
    );
    golden.observe(
      'raw.arrayAggEnumColumn',
      await outcome(
        () =>
          prisma.$queryRaw<Array<{ roles: unknown }>>`
            SELECT array_agg(r ORDER BY r) AS roles
            FROM unnest(ARRAY['USER', 'ADMIN']::"Role"[]) AS r`,
        rows => describeValue(rows[0]?.roles)
      )
    );
    golden.observe(
      'raw.emptyEnumArray',
      await outcome(
        () => prisma.$queryRaw<Array<{ v: unknown }>>`SELECT ARRAY[]::"Role"[] AS v`,
        rows => describeValue(rows[0]?.v)
      )
    );
  });

  it('binds enum arrays as raw parameters', async () => {
    golden.observe(
      'raw.paramOverlap',
      await outcome(
        () =>
          prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM "Service"
            WHERE id LIKE ${`${RUN}-%`}
              AND "serviceNotificationChannels" && ${['SLACK', 'SMS']}::"NotificationChannel"[]`,
        rows => describeValue(rows[0]?.n)
      )
    );
    golden.observe(
      'raw.paramAny',
      await outcome(
        () =>
          prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM "Service"
            WHERE id LIKE ${`${RUN}-%`}
              AND ${'MICROSOFT_TEAMS'}::"NotificationChannel" = ANY("serviceNotificationChannels")`,
        rows => describeValue(rows[0]?.n)
      )
    );
    golden.observe(
      'raw.updateWithParam',
      await outcome(async () => {
        await prisma.$executeRaw`
          UPDATE "Service" SET "serviceNotificationChannels" = ${['VOICE', 'WEBHOOK']}::"NotificationChannel"[]
          WHERE id = ${`${RUN}-c`}`;
        return (
          await prisma.service.findUniqueOrThrow({
            where: { id: `${RUN}-c` },
            select: { serviceNotificationChannels: true },
          })
        ).serviceNotificationChannels;
      }, describeValue)
    );
    golden.observe(
      'raw.joinedEnumList',
      await outcome(
        () =>
          prisma.$queryRaw<Array<{ n: bigint }>>`
            SELECT count(*) AS n FROM "Service"
            WHERE id LIKE ${`${RUN}-%`}
              AND "serviceNotificationChannels" && ARRAY[${Prisma.join(
                ['EMAIL', 'PUSH'].map(c => Prisma.sql`${c}::"NotificationChannel"`)
              )}]`,
        rows => describeValue(rows[0]?.n)
      )
    );
  });
});
