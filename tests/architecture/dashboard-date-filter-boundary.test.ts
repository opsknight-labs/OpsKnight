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

  it('passes only the nested Prisma filter into buildIncidentWhere', () => {
    const source = readFileSync('src/app/(app)/page.tsx', 'utf8');

    expect(source).toContain('dateFilter: dateFilter.where');
    expect(source).not.toContain('buildIncidentWhere(filterParams, { dateFilter })');
  });
});
