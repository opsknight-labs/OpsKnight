import { describe, expect, it } from 'vitest';
import {
  USAGE_RANGE_MAX_DAYS,
  parseUsageDate,
  resolveUsageRange,
} from '@/app/(app)/settings/integrations/mcp/usage-range';

const now = new Date('2026-11-12T15:00:00.000Z');

describe('Usage custom range', () => {
  it('covers whole UTC days, the end date included', () => {
    const range = resolveUsageRange('2026-11-01', '2026-11-03', 30, now);
    expect(range).toEqual({
      ok: true,
      since: new Date('2026-11-01T00:00:00.000Z'),
      until: new Date('2026-11-04T00:00:00.000Z'),
      from: '2026-11-01',
      to: '2026-11-03',
    });
  });

  it('rejects dates that are not real calendar dates', () => {
    expect(parseUsageDate('2026-02-30')).toBeNull();
    expect(parseUsageDate('2026-1-1')).toBeNull();
    expect(parseUsageDate("2026-01-01' OR 1=1")).toBeNull();
    expect(resolveUsageRange('', '2026-11-03', 30, now).ok).toBe(false);
  });

  it('requires from before to', () => {
    expect(resolveUsageRange('2026-11-03', '2026-11-03', 30, now)).toMatchObject({
      ok: false,
      error: /before the end date/,
    });
    expect(resolveUsageRange('2026-11-05', '2026-11-03', 30, now).ok).toBe(false);
  });

  it('refuses a start before what the request log still holds', () => {
    expect(resolveUsageRange('2026-10-13', '2026-11-01', 30, now).ok).toBe(true);
    expect(resolveUsageRange('2026-10-12', '2026-11-01', 30, now)).toMatchObject({
      ok: false,
      error: /kept for 30 days.*2026-10-13/,
    });
  });

  it(`caps a range at ${USAGE_RANGE_MAX_DAYS} days even with longer retention`, () => {
    expect(resolveUsageRange('2025-11-12', '2026-11-12', 1000, now).ok).toBe(true);
    expect(resolveUsageRange('2025-11-11', '2026-11-12', 1000, now).ok).toBe(false);
  });

  it('refuses a range that starts in the future', () => {
    expect(resolveUsageRange('2026-11-13', '2026-11-20', 30, now)).toMatchObject({ ok: false });
  });
});
