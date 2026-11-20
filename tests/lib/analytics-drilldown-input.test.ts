import { describe, expect, it } from 'vitest';
import { drillInputSchema, encodeDrillCursor } from '@/lib/analytics/drilldown';

describe('analytics drill-down input', () => {
  it('defaults to all incidents and round-trips a cursor', () => {
    const createdAt = new Date('2026-01-15T18:00:00.123Z');
    const parsed = drillInputSchema.parse({
      cursor: encodeDrillCursor({ createdAt, id: 'clx_1-a' }),
    });
    expect(parsed).toEqual({ drill: 'all', cursor: { createdAt, id: 'clx_1-a' } });
  });

  it.each([
    { drill: 'deleteAll' },
    { serviceId: "x' OR 1=1 --" },
    { serviceId: '' },
    { cursor: 'not-a-cursor' },
    { cursor: '2026-13-45T99:99:99.000Z~abc' },
    { cursor: `2026-01-15T18:00:00.000Z~${'a'.repeat(65)}` },
  ])('rejects %j', input => {
    expect(drillInputSchema.safeParse(input).success).toBe(false);
  });
});
