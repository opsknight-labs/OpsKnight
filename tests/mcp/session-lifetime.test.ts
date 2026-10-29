import { describe, expect, it } from 'vitest';
import { mcpSessionDates, slideMcpExpiry } from '@/lib/mcp/auth/session-lifetime';

const DAY = 86_400_000;
const now = new Date('2026-10-30T00:00:00Z');

describe('MCP sliding sessions', () => {
  it('starts with the idle window and a 90 day absolute cap', () => {
    const dates = mcpSessionDates(now, undefined);
    expect(dates.expiresAt.getTime() - now.getTime()).toBe(30 * DAY);
    expect(dates.absoluteExpiresAt.getTime() - now.getTime()).toBe(90 * DAY);
  });

  it('clamps administrator values to the supported range', () => {
    expect(mcpSessionDates(now, 0).expiresAt.getTime() - now.getTime()).toBe(DAY);
    expect(mcpSessionDates(now, 500).expiresAt.getTime() - now.getTime()).toBe(90 * DAY);
  });

  it('extends on use but never past the absolute cap or backwards', () => {
    const later = new Date(now.getTime() + 20 * DAY);
    const absolute = new Date(now.getTime() + 90 * DAY);
    const current = new Date(now.getTime() + 30 * DAY);
    expect(slideMcpExpiry(later, 30, current, absolute).getTime()).toBe(later.getTime() + 30 * DAY);
    const nearEnd = new Date(now.getTime() + 80 * DAY);
    expect(slideMcpExpiry(nearEnd, 30, current, absolute).getTime()).toBe(absolute.getTime());
    expect(slideMcpExpiry(now, 1, current, absolute).getTime()).toBe(current.getTime());
  });

  it('clamps an expiry that already exceeds the absolute cap', () => {
    const absolute = new Date(now.getTime() + 5 * DAY);
    const current = new Date(now.getTime() + 30 * DAY);
    expect(slideMcpExpiry(now, 30, current, absolute).getTime()).toBe(absolute.getTime());
  });

  it('slides without a cap for grants created before sliding sessions', () => {
    const current = new Date(now.getTime() + DAY);
    expect(slideMcpExpiry(now, 30, current, null).getTime()).toBe(now.getTime() + 30 * DAY);
  });
});
