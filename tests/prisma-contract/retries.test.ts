import { afterAll, describe, it } from 'vitest';
import prisma, { disconnectPrisma } from '@/lib/prisma';
import { runReadCommittedTransaction, runSerializableTransaction } from '@/lib/db-utils';
import { outcome } from './support/classify';
import { goldenFile } from './support/golden';

const golden = goldenFile('retries');
const RUN = `contract-retry-${process.pid}-${Date.now()}`;

afterAll(async () => {
  await prisma.ingestionQuota.deleteMany({ where: { key: { startsWith: RUN } } });
  await disconnectPrisma();
});

const raise = (state: string) =>
  `DO $$ BEGIN RAISE EXCEPTION 'contract retry' USING ERRCODE = '${state}'; END $$`;

describe('OpsKnight transaction retry wrappers against real database errors', () => {
  for (const [name, run] of [
    ['serializable', runSerializableTransaction],
    ['readCommitted', runReadCommittedTransaction],
  ] as const) {
    for (const state of ['40001', '40P01', '23505', '57014']) {
      it(`${name} retries only retryable SQLSTATE ${state}`, async () => {
        let attempts = 0;
        const result = await outcome(() =>
          run(async tx => {
            attempts += 1;
            if (attempts === 1) await tx.$executeRawUnsafe(raise(state));
            return 'committed';
          }, 3)
        );
        golden.observe(`${name}.raise.${state}`, { attempts, result });
      });
    }
  }

  it('serializable wrapper resolves a real write-skew conflict by retrying', async () => {
    await prisma.ingestionQuota.createMany({
      data: ['a', 'b'].map(suffix => ({
        key: `${RUN}-${suffix}`,
        tokens: 0,
        rate: 1,
        burst: 1,
        updatedAt: new Date(),
        lastAllowed: false,
      })),
    });
    let attempts = 0;
    let gate!: () => void;
    const bothRead = new Promise<void>(resolve => (gate = resolve));
    let reads = 0;
    const worker = (suffix: 'a' | 'b') =>
      runSerializableTransaction(async tx => {
        attempts += 1;
        const rows = await tx.ingestionQuota.findMany({ where: { key: { startsWith: RUN } } });
        reads += 1;
        if (reads === 2) gate();
        if (reads <= 2) await Promise.race([bothRead, new Promise(r => setTimeout(r, 500))]);
        await tx.ingestionQuota.update({
          where: { key: `${RUN}-${suffix}` },
          data: { tokens: rows.reduce((sum, row) => sum + row.tokens, 0) + 1 },
        });
        return true;
      }, 5);
    const results = await Promise.all([outcome(() => worker('a')), outcome(() => worker('b'))]);
    golden.observe('serializable.realConflict', {
      results,
      retried: attempts > 2,
      finalTokens: (
        await prisma.ingestionQuota.findMany({
          where: { key: { startsWith: RUN } },
          orderBy: { key: 'asc' },
        })
      )
        .map(row => row.tokens)
        .sort(),
    });
  });
});
