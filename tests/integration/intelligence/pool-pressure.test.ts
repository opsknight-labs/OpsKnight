import { PrismaClient } from '@prisma/client';
import { expect, it } from 'vitest';
import { getPrismaPoolWaitCount } from '@/lib/prisma-pool-pressure';

it('observes real waiting queries while the only pool connection is occupied', async () => {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!url.pathname.endsWith('_test')) throw new Error('Dedicated test DB required');
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('pool_timeout', '5');
  const client = new PrismaClient({ datasourceUrl: url.toString() });
  let ready!: () => void;
  let release!: () => void;
  const acquired = new Promise<void>(resolve => {
    ready = resolve;
  });
  const held = new Promise<void>(resolve => {
    release = resolve;
  });
  const holder = client.$transaction(
    async tx => {
      await tx.$queryRaw`SELECT 1`;
      ready();
      await held;
    },
    { timeout: 10000 }
  );
  let queued: Promise<unknown> | undefined;
  try {
    // Do not let an early acquisition failure leave the test waiting indefinitely.
    await Promise.race([
      acquired,
      holder.then(() => {
        throw new Error('Holder finished before acquisition');
      }),
    ]);
    queued = client.$queryRaw`SELECT 1`.then(value => value);
    await expect
      .poll(() => getPrismaPoolWaitCount(client), { timeout: 3000, interval: 20 })
      .toBeGreaterThan(0);
  } finally {
    release();
    await Promise.allSettled([holder, queued]);
    await client.$disconnect();
  }
});
