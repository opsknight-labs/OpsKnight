import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { testPrisma as db } from '../../helpers/test-db';

it('upgrades legacy aggregate usage conservatively without changing global totals or granting extra allowance', async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  const migration = readFileSync(
    resolve('prisma/migrations/20261105000100_intelligence_embedding_budget/migration.sql'),
    'utf8'
  );
  const statements = migration
    .replace(/--[^\n]*/g, '')
    .split(';')
    .map(sql => sql.trim())
    .filter(Boolean);
  // Transaction-local temporary tables shadow only these two legacy table names. ON COMMIT DROP
  // also prevents a pooled connection from retaining the fixture after this real migration runs.
  await db.$transaction(async tx => {
    await tx.$executeRaw`CREATE TEMP TABLE "AiSettings" (id text PRIMARY KEY, "dailyTokenBudget" integer NOT NULL DEFAULT 1000) ON COMMIT DROP`;
    await tx.$executeRaw`CREATE TEMP TABLE "AiUsageDay" (day text PRIMARY KEY, requests integer NOT NULL DEFAULT 0, "inputTokens" integer NOT NULL DEFAULT 0, "outputTokens" integer NOT NULL DEFAULT 0) ON COMMIT DROP`;
    await tx.$executeRaw`INSERT INTO "AiSettings" (id) VALUES ('default')`;
    await tx.$executeRaw`INSERT INTO "AiUsageDay" (day, requests, "inputTokens", "outputTokens") VALUES (to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD'), 2, 120, 30), ('2000-01-01', 4, 400, 100)`;
    for (const statement of statements) await tx.$executeRawUnsafe(statement);
    const rows = await tx.$queryRaw<
      Array<{
        day: string;
        requests: number;
        inputTokens: number;
        outputTokens: number;
        backgroundEmbeddingTokens: number;
      }>
    >`SELECT * FROM "AiUsageDay" ORDER BY day`;
    expect(rows).toEqual([
      {
        day: '2000-01-01',
        requests: 4,
        inputTokens: 400,
        outputTokens: 100,
        backgroundEmbeddingTokens: 0,
      },
      {
        day: new Date().toISOString().slice(0, 10),
        requests: 2,
        inputTokens: 120,
        outputTokens: 30,
        backgroundEmbeddingTokens: 150,
      },
    ]);
    const settings = await tx.$queryRaw<
      Array<{ dailyTokenBudget: number; backgroundEmbeddingBudgetPercent: number }>
    >`SELECT "dailyTokenBudget", "backgroundEmbeddingBudgetPercent" FROM "AiSettings"`;
    expect(settings).toEqual([{ dailyTokenBudget: 1000, backgroundEmbeddingBudgetPercent: 20 }]);
    await tx.$executeRaw`SAVEPOINT invalid_allocation`;
    await expect(
      tx.$executeRaw`UPDATE "AiSettings" SET "backgroundEmbeddingBudgetPercent" = 81`
    ).rejects.toMatchObject({ code: 'P2010' });
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT invalid_allocation`;
    await expect(
      tx.$executeRaw`UPDATE "AiSettings" SET "backgroundEmbeddingBudgetPercent" = 0`
    ).resolves.toBe(1);
  });
});
