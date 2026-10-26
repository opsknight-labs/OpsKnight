import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('dashboard retained date-filter boundary', () => {
  it('separates Prisma query fields from retention metadata', () => {
    const source = readFileSync('src/lib/dashboard-utils.ts', 'utf8');

    expect(source).toContain('where: IncidentDateWhere');
    expect(source).toContain('window: {');
    expect(source).not.toMatch(/return\s*{\s*createdAt:[\s\S]{0,160}isClipped:/);
    expect(source).not.toContain('{ ...dateFilter }');
  });

  it('keeps reporting date windows out of the live dashboard projection', () => {
    // Live state is "active now"; retention/reporting windows apply only to history analytics.
    const live = readFileSync('src/lib/dashboard/live-incidents.ts', 'utf8');
    const page = readFileSync('src/app/(app)/page.tsx', 'utf8');

    expect(live).not.toContain('buildRetainedDateFilter');
    expect(live).not.toContain('@/lib/dashboard-utils');
    expect(page).not.toContain('buildIncidentWhere');
  });
});
