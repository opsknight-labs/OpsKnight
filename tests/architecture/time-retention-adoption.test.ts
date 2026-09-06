import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const adoptedPaths = [
  [
    'src/lib/dashboard/dashboard-operational-snapshot.ts',
    readFileSync('src/lib/dashboard/dashboard-operational-snapshot.ts', 'utf8'),
  ],
  ['src/app/api/widgets/data/route.ts', readFileSync('src/app/api/widgets/data/route.ts', 'utf8')],
  [
    'src/app/api/widgets/stream/route.ts',
    readFileSync('src/app/api/widgets/stream/route.ts', 'utf8'),
  ],
  [
    'src/app/api/analytics/export/route.ts',
    readFileSync('src/app/api/analytics/export/route.ts', 'utf8'),
  ],
  [
    'src/app/api/status/history/route.ts',
    readFileSync('src/app/api/status/history/route.ts', 'utf8'),
  ],
  ['src/app/api/status/route.ts', readFileSync('src/app/api/status/route.ts', 'utf8')],
  ['src/app/(public)/status/page.tsx', readFileSync('src/app/(public)/status/page.tsx', 'utf8')],
] as const;

describe('time and retention adoption', () => {
  it.each(adoptedPaths)('%s uses a centralized retained reporting window', (_path, source) => {
    expect(source).toMatch(/buildRetainedDateFilter|getReportingWindowForDays/);
  });

  it.each(adoptedPaths)('%s does not independently mutate calendar dates', (_path, source) => {
    expect(source).not.toMatch(/\.setDate\(/);
  });
});
