import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

/**
 * Retention treats "relation does not exist" as "nothing to purge yet" so a rolling deploy never fails a
 * sweep. That also hides a step aimed at a table that was never there (`"NoiseDecision"` instead of
 * `"PrePagingDecision"` logged a Prisma error on every run and purged nothing). Every table the raw SQL
 * names must be a real model.
 */
describe('intelligence retention SQL', () => {
  it('only names tables that exist in the schema', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/lib/intelligence/jobs/retention.ts'),
      'utf8'
    );
    const named = new Set(
      [...source.matchAll(/\b(?:FROM|JOIN)\s+"([A-Za-z0-9_]+)"/g)].map(match => match[1])
    );
    const tables = new Set(Prisma.dmmf.datamodel.models.map(model => model.dbName ?? model.name));
    expect(named.size).toBeGreaterThan(10);
    expect([...named].filter(name => !tables.has(name))).toEqual([]);
  });
});
