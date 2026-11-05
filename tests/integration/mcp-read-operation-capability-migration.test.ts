// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const migration = readFileSync(
  'prisma/migrations/20261105000200_mcp_read_operation_capability/migration.sql',
  'utf8'
);
const statement = migration
  .split('\n')
  .filter(line => !line.trim().startsWith('--'))
  .join('\n')
  .trim()
  .replace(/;$/, '');

class Rollback extends Error {}

/** Runs the migration against the default policy with `before` stored, then rolls back. */
async function migrated(before: string[], runs = 1) {
  let after: string[] | undefined;
  await testPrisma
    .$transaction(async tx => {
      await tx.mcpPolicy.upsert({
        where: { id: 'default' },
        create: { id: 'default', disabledCapabilities: before },
        update: { disabledCapabilities: before },
      });
      for (let run = 0; run < runs; run++) await tx.$executeRawUnsafe(statement);
      after = (await tx.mcpPolicy.findUniqueOrThrow({ where: { id: 'default' } }))
        .disabledCapabilities;
      throw new Rollback();
    })
    .catch(error => {
      if (!(error instanceof Rollback)) throw error;
    });
  return after;
}

describeIfRealDB('read_operation capability migration', () => {
  it('keeps generic reads off where an administrator had turned call_operation off', async () => {
    expect(await migrated(['call_operation', 'listIncidents'])).toEqual([
      'call_operation',
      'listIncidents',
      'read_operation',
    ]);
  });

  it('leaves other policies alone and is safe to re-run', async () => {
    expect(await migrated([])).toEqual([]);
    expect(await migrated(['domain:mcp'])).toEqual(['domain:mcp']);
    expect(await migrated(['listIncidents'])).toEqual(['listIncidents']);
    expect(await migrated(['call_operation'], 2)).toEqual(['call_operation', 'read_operation']);
  });
});
