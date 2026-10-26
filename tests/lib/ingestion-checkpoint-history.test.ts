import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const { seedCounts } = createRequire(import.meta.url)(
  '../../scripts/ingestion/seed-checkpoint-history.cjs'
);
describe('bounded synthetic history fixture', () => {
  it.each([
    ['0', '1'],
    ['1.5', '1'],
    ['100001', '1'],
    ['1', '1000001'],
    ['NaN', '1'],
  ])('rejects invalid row counts %s/%s', (incidents, jobs) => {
    expect(() => seedCounts([incidents, jobs])).toThrow();
  });
  it('accepts a small smoke fixture without importing or opening a database', () => {
    expect(seedCounts(['2', '3'])).toEqual({ incidents: 2, jobs: 3 });
  });
});
