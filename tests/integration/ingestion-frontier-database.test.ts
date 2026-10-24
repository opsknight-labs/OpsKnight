import { beforeEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';

const database = new URL(process.env.DATABASE_URL ?? 'http://missing');
if (
  !['127.0.0.1', 'localhost'].includes(database.hostname) ||
  !database.pathname.startsWith('/ingestion_test') ||
  !database.pathname.endsWith('_test')
)
  throw new Error('Dedicated localhost ingestion_test database required');

beforeEach(async () => {
  await prisma.$executeRaw`TRUNCATE "IngestionOrderingHead", "IngestionReceipt" CASCADE`;
});

async function append(keys: string[], serviceId = 'frontier-service') {
  return prisma.ingestionReceipt.create({
    data: {
      id: randomUUID(),
      serviceId,
      integrationId: 'frontier-integration',
      partitionKey: keys[0] ?? 'legacy',
      orderingKeys: keys,
      idempotencyKey: randomUUID(),
      contentHash: 'frontier-fixture',
      budgetShard: 0,
      payloadBytes: 1,
      envelope: {},
      availableAt: new Date(0),
    },
  });
}

async function finish(id: string, status = 'COMPLETED') {
  // Represents an older image's unchanged receipt write: no frontier fields.
  await prisma.ingestionReceipt.update({ where: { id }, data: { status } });
}

async function assertFrontier() {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      orderingWaitCount: number;
      actualWaitCount: number;
      maintainedReady: boolean;
      historyReady: boolean;
      status: string;
      frontierEntries: number;
    }>
  >`
    SELECT r."id", r."orderingWaitCount", r."status",
      (SELECT count(*)::int FROM "IngestionOrderingHead" head
        WHERE head."headId" = r."id" AND head."headPrimary" AND head."headReady"
          AND head."headActive" AND head."headCritical" = r."critical") AS "frontierEntries",
      (SELECT count(*)::int FROM "IngestionOrderingLink" link
        WHERE link."receiptId" = r."id" AND link."predecessorId" IS NOT NULL) AS "actualWaitCount",
      (r."orderingWaitCount" = 0 AND NOT EXISTS (
        SELECT 1 FROM "IngestionOrderingHead" barrier
        WHERE barrier."identity" = 'unidentified:' || r."serviceId"
          AND barrier."headSequence" < r."sequence"
      )) AS "maintainedReady",
      NOT EXISTS (SELECT 1 FROM "IngestionReceipt" previous
        WHERE previous."status" NOT IN ('COMPLETED', 'ARCHIVED')
          AND previous."sequence" < r."sequence"
          AND previous."orderingKeys" && array_append(r."orderingKeys", 'unidentified:' || r."serviceId")
      ) AS "historyReady"
    FROM "IngestionReceipt" r WHERE r."status" NOT IN ('COMPLETED', 'ARCHIVED')
  `;
  for (const row of rows) {
    expect(row.orderingWaitCount).toBe(row.actualWaitCount);
    expect(row.maintainedReady, row.id).toBe(row.historyReady);
    expect(row.frontierEntries).toBe(
      row.orderingWaitCount === 0 && ['PENDING', 'PROCESSING'].includes(row.status) ? 1 : 0
    );
  }
  return rows
    .filter(row => row.maintainedReady)
    .map(row => row.id)
    .sort();
}

it('advances canonical and legacy chains only after every predecessor finishes', async () => {
  const a = await append(['canonical:a', 'legacy:x']);
  const b = await append(['canonical:b', 'legacy:x']);
  const c = await append(['canonical:a']);
  const d = await append(['canonical:independent']);
  expect(await assertFrontier()).toEqual([a.id, d.id].sort());
  await finish(a.id);
  expect(await assertFrontier()).toEqual([b.id, c.id, d.id].sort());
  for (const receipt of [b, c, d]) await finish(receipt.id);
  expect(await assertFrontier()).toEqual([]);
  const [counts] = await prisma.$queryRaw<Array<{ heads: number; links: number }>>`
    SELECT (SELECT count(*)::int FROM "IngestionOrderingHead") AS heads,
      (SELECT count(*)::int FROM "IngestionOrderingLink") AS links
  `;
  expect(counts).toEqual({ heads: 0, links: 0 });
});

it('retains two dependencies through retry and dead-letter disposition', async () => {
  const a = await append(['a']);
  const b = await append(['b']);
  const both = await append(['a', 'b']);
  const afterA = await append(['a']);
  const afterB = await append(['b']);
  await finish(a.id);
  await finish(b.id, 'DEAD');
  expect(await assertFrontier()).toEqual([b.id]);
  await finish(b.id, 'PENDING');
  expect(await assertFrontier()).toEqual([b.id]);
  await finish(b.id, 'ARCHIVED');
  expect(await assertFrontier()).toEqual([both.id]);
  await finish(both.id);
  expect(await assertFrontier()).toEqual([afterA.id, afterB.id].sort());
});

it('splices an older repaired poison identity ahead of newer receipts', async () => {
  const poison = await append(['unidentified:frontier-service']);
  await finish(poison.id, 'DEAD');
  const next = await append(['a']);
  const last = await append(['a']);
  const independent = await append(['other'], 'other-service');
  expect(await assertFrontier()).toEqual([poison.id, independent.id].sort());
  await prisma.ingestionReceipt.update({ where: { id: poison.id }, data: { orderingKeys: ['a'] } });
  expect(await assertFrontier()).toEqual([poison.id, independent.id].sort());
  await finish(poison.id, 'ARCHIVED');
  expect(await assertFrontier()).toEqual([next.id, independent.id].sort());
  await finish(next.id);
  expect(await assertFrontier()).toEqual([last.id, independent.id].sort());
});

it('repairs an interior identity without releasing the successor past its predecessor', async () => {
  const first = await append(['a']);
  const middle = await append(['a']);
  const last = await append(['a']);
  await prisma.ingestionReceipt.update({ where: { id: middle.id }, data: { orderingKeys: ['b'] } });
  expect(await assertFrontier()).toEqual([first.id, middle.id].sort());
  await finish(first.id);
  expect(await assertFrontier()).toEqual([middle.id, last.id].sort());
});

it('rolls back dependent metadata with a failed durable receipt transaction', async () => {
  const first = await append(['a']);
  await expect(
    prisma.$transaction(async tx => {
      await tx.ingestionReceipt.create({
        data: {
          id: randomUUID(),
          serviceId: 'frontier-service',
          integrationId: 'frontier-integration',
          partitionKey: 'a',
          orderingKeys: ['a'],
          idempotencyKey: randomUUID(),
          contentHash: 'rollback',
          budgetShard: 0,
          payloadBytes: 1,
          envelope: {},
        },
      });
      throw new Error('injected-frontier-rollback');
    })
  ).rejects.toThrow('injected-frontier-rollback');
  expect(await assertFrontier()).toEqual([first.id]);
  const [counts] = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT count(*)::int AS count FROM "IngestionOrderingLink"
  `;
  expect(counts.count).toBe(1);
});

it('admits a successor while an older worker holds its predecessor FOR UPDATE', async () => {
  const first = await append(['a']);
  let unlock!: () => void;
  let locked!: () => void;
  const ready = new Promise<void>(resolve => {
    locked = resolve;
  });
  const release = new Promise<void>(resolve => {
    unlock = resolve;
  });
  const holder = prisma.$transaction(
    async tx => {
      await tx.$queryRaw`SELECT "id" FROM "IngestionReceipt" WHERE "id" = ${first.id} FOR UPDATE`;
      locked();
      await release;
    },
    { timeout: 10000 }
  );
  await ready;
  let admitted = false;
  const pending = append(['a']).then(result => {
    admitted = true;
    return result;
  });
  try {
    await Promise.race([pending, new Promise(resolve => setTimeout(resolve, 500))]);
    expect(admitted).toBe(true);
  } finally {
    unlock();
    await holder;
    await pending;
  }
  expect(await assertFrontier()).toEqual([first.id]);
});

it('keeps skipped conflicting inserts out of the derived frontier', async () => {
  const first = await append(['a']);
  await prisma.$executeRaw`
    INSERT INTO "IngestionReceipt" ("id", "serviceId", "integrationId", "partitionKey",
      "orderingKeys", "idempotencyKey", "contentHash", "budgetShard", "payloadBytes", "envelope")
    VALUES (${randomUUID()}, 'frontier-service', 'frontier-integration', 'b', ARRAY['b'],
      ${first.idempotencyKey}, 'ignored-conflict', 0, 1, '{}'::jsonb)
    ON CONFLICT ("idempotencyKey") DO NOTHING
  `;
  expect(await assertFrontier()).toEqual([first.id]);
  expect(await prisma.ingestionReceipt.count()).toBe(1);
  const [counts] = await prisma.$queryRaw<Array<{ heads: number; links: number }>>`
    SELECT (SELECT count(*)::int FROM "IngestionOrderingHead") AS heads,
      (SELECT count(*)::int FROM "IngestionOrderingLink") AS links
  `;
  expect(counts).toEqual({ heads: 1, links: 1 });
});

it('advances and removes derived pointers when an unfinished owner is deleted', async () => {
  const first = await append(['a']);
  const next = await append(['a']);
  await prisma.ingestionReceipt.delete({ where: { id: first.id } });
  expect(await assertFrontier()).toEqual([next.id]);
  await prisma.ingestionReceipt.delete({ where: { id: next.id } });
  const [counts] = await prisma.$queryRaw<Array<{ heads: number; links: number }>>`
    SELECT (SELECT count(*)::int FROM "IngestionOrderingHead") AS heads,
      (SELECT count(*)::int FROM "IngestionOrderingLink") AS links
  `;
  expect(counts).toEqual({ heads: 0, links: 0 });
});

it('keeps the eligible severity lane aligned with a receipt update', async () => {
  const receipt = await append(['severity']);
  await prisma.ingestionReceipt.update({ where: { id: receipt.id }, data: { critical: true } });
  expect(await assertFrontier()).toEqual([receipt.id]);
  await finish(receipt.id, 'DEAD');
  await assertFrontier();
  await finish(receipt.id, 'PENDING');
  expect(await assertFrontier()).toEqual([receipt.id]);
});

it('matches history eligibility while draining intersecting identity chains', async () => {
  for (let index = 0; index < 40; index++)
    await append([`canonical:${index % 5}`, `legacy:${(index * 3) % 7}`]);
  for (let index = 0; index < 40; index++) {
    const ready = await assertFrontier();
    expect(ready.length).toBeGreaterThan(0);
    await finish(ready[0]);
  }
  expect(await assertFrontier()).toEqual([]);
});
