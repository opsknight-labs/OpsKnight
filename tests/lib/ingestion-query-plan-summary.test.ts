import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
const { boundedPlan } = createRequire(import.meta.url)('../../scripts/ingestion/query-plan-summary.cjs');

describe('bounded query-plan evidence', () => {
  it('retains cost/working-set evidence while stripping SQL and values recursively', () => {
    const result = boundedPlan({
      'Node Type': 'Index Scan', 'Index Name': 'active_jobs_idx', 'Actual Rows': 100,
      'Filter': "payload = 'private-provider-token'", 'Output': ['private-value'],
      Plans: [{ 'Node Type': 'Index Only Scan', 'Shared Hit Blocks': 4, 'Index Cond': "id = 'private-id'" }],
    });
    expect(result).toEqual({
      'Node Type': 'Index Scan', 'Index Name': 'active_jobs_idx', 'Actual Rows': 100,
      Plans: [{ 'Node Type': 'Index Only Scan', 'Shared Hit Blocks': 4 }],
    });
    expect(JSON.stringify(result)).not.toContain('private');
  });
});
