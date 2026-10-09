import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Prisma, PrismaClient } from '@prisma/client';
import prisma from '@/lib/prisma';
import { testPrisma as db, resetDatabase } from '../helpers/test-db';
import {
  acquireProviderAdmission,
  forceProductionModeForTests,
  resetProviderAdmissionForTests,
} from '@/lib/provider-admission';
import { resetCapacityResolverForTests } from '@/lib/notification-capacity/resolver';

beforeEach(async () => {
  await resetDatabase();
  resetProviderAdmissionForTests();
  resetCapacityResolverForTests();
  forceProductionModeForTests();
}, 30_000);
afterEach(() => {
  resetProviderAdmissionForTests();
});
afterAll(async () => {
  await db.$disconnect();
});

async function configure(ratePerSecond: number) {
  await db.notificationProviderCapacity.create({
    data: {
      provider: 'smtp',
      channel: 'EMAIL',
      mode: 'CUSTOM',
      ratePerSecond,
      maxInFlight: 40,
      bulkSharePercent: 80,
      adaptiveBackpressure: false,
    },
  });
}

it('leaves shared urgent quota available to eight independently cold replicas', async () => {
  await configure(200);
  const now = new Date(Date.now() + 60_000);
  for (let replica = 0; replica < 8; replica++) {
    // A new replica has no process-local quota cache.
    resetProviderAdmissionForTests();
    forceProductionModeForTests();
    expect(await acquireProviderAdmission('EMAIL', 'smtp', now, 'CRITICAL')).toEqual({
      allowed: true,
    });
  }
  const window = await db.providerQuotaWindow.findFirstOrThrow();
  expect(window.globalUsed).toBe(40);
  expect(window.globalUsed).toBeLessThan(200);
});

it('does not oversubscribe a rate window when eight allocation snapshots overlap', async () => {
  await configure(7);
  const now = new Date(Date.now() + 60_000);
  let allocation: Prisma.Sql | undefined;
  const original = prisma.$queryRaw.bind(prisma);
  const interception = vi.spyOn(prisma, '$queryRaw').mockImplementation(((
    ...args: Parameters<typeof prisma.$queryRaw>
  ) => {
    const query = args[0];
    if ('strings' in query && query.strings.join('').includes('ProviderQuotaWindow'))
      allocation = query;
    return original(...args);
  }) as typeof prisma.$queryRaw);
  try {
    expect(await acquireProviderAdmission('EMAIL', 'smtp', now, 'CRITICAL')).toEqual({
      allowed: true,
    });
  } finally {
    interception.mockRestore();
  }
  expect(allocation).toBeDefined();
  const strings = [...allocation!.strings];
  strings[0] = '/* automation-quota-race */ ' + strings[0];
  const query = Prisma.sql(strings, ...allocation!.values);
  const window = await db.providerQuotaWindow.findFirstOrThrow();
  const gateClient = new PrismaClient();
  // The default CI pool has five connections; this race requires eight statements
  // to establish their snapshots simultaneously, independently of the observer.
  const allocationUrl = new URL(process.env.DATABASE_URL!);
  allocationUrl.searchParams.set('connection_limit', '8');
  const allocationClient = new PrismaClient({
    datasources: { db: { url: allocationUrl.toString() } },
  });
  let releaseGate!: () => void;
  let announceGate!: () => void;
  const release = new Promise<void>(resolve => {
    releaseGate = resolve;
  });
  const ready = new Promise<void>(resolve => {
    announceGate = resolve;
  });
  const gate = gateClient.$transaction(
    async tx => {
      // Before release, the other statements see the previous committed usage.
      await tx.providerQuotaWindow.update({ where: { id: window.id }, data: { globalUsed: 0 } });
      announceGate();
      await release;
    },
    { timeout: 20_000 }
  );
  await ready;
  const allocations = Array.from({ length: 8 }, () =>
    allocationClient.$queryRaw<Array<{ granted: number }>>(query)
  );
  const completed = Promise.allSettled(allocations);
  try {
    await expect
      .poll(
        async () => {
          const [row] = await db.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM pg_stat_activity
        WHERE query LIKE '%automation-quota-race%' AND wait_event_type = 'Lock'
      `;
          return Number(row.count);
        },
        { timeout: 10_000 }
      )
      .toBe(8);
    releaseGate();
    await gate;
    const results = await completed;
    expect(results.every(result => result.status === 'fulfilled')).toBe(true);
    const granted = results
      .flatMap(result => (result.status === 'fulfilled' ? result.value : []))
      .reduce((total, row) => total + row.granted, 0);
    expect(granted).toBe(7);
    expect(
      (await db.providerQuotaWindow.findUniqueOrThrow({ where: { id: window.id } })).globalUsed
    ).toBe(7);
  } finally {
    releaseGate();
    await Promise.allSettled([gate, completed]);
    await Promise.all([gateClient.$disconnect(), allocationClient.$disconnect()]);
  }
}, 30_000);
