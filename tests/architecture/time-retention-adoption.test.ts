import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const adoptedPaths = [
  'src/app/(app)/page.tsx',
  'src/app/api/widgets/data/route.ts',
  'src/app/api/widgets/stream/route.ts',
  'src/app/api/analytics/export/route.ts',
  'src/app/api/status/history/route.ts',
  'src/app/api/status/route.ts',
  'src/app/(public)/status/page.tsx',
];

describe('time and retention adoption', () => {
  it.each(adoptedPaths)('%s uses a centralized retained reporting window', path => {
    const source = readFileSync(path, 'utf8');
    expect(source).toMatch(/buildRetainedDateFilter|getReportingWindowForDays/);
  });

  it.each(adoptedPaths)('%s does not independently mutate calendar dates', path => {
    const source = readFileSync(path, 'utf8');
    expect(source).not.toMatch(/\.setDate\(/);
  });
});
