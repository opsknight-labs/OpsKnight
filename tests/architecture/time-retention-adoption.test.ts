import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const adoptedPaths = [
  ['src/app/api/widgets/data/route.ts', readFileSync('src/app/api/widgets/data/route.ts', 'utf8')],
  [
    'src/app/api/widgets/stream/route.ts',
    readFileSync('src/app/api/widgets/stream/route.ts', 'utf8'),
  ],
  [
    'src/app/api/insights/export/route.ts',
    readFileSync('src/app/api/insights/export/route.ts', 'utf8'),
  ],
  ['src/lib/analytics/window.ts', readFileSync('src/lib/analytics/window.ts', 'utf8')],
  [
    'src/app/api/status/history/handler.ts',
    readFileSync('src/app/api/status/history/handler.ts', 'utf8'),
  ],
  ['src/lib/status-pages/snapshot.ts', readFileSync('src/lib/status-pages/snapshot.ts', 'utf8')],
  ['src/lib/status-pages/snapshot.ts', readFileSync('src/lib/status-pages/snapshot.ts', 'utf8')],
] as const;

describe('time and retention adoption', () => {
  it.each(adoptedPaths)('%s uses a centralized retained reporting window', (_path, source) => {
    expect(source).toMatch(
      /buildRetainedDateFilter|getReportingWindowForDays|resolveReportingWindow|createAnalyticsContext/
    );
  });

  it.each(adoptedPaths)('%s does not independently mutate calendar dates', (_path, source) => {
    expect(source).not.toMatch(/\.setDate\(/);
  });
});
