import { describe, expect, it } from 'vitest';
import { formatDateForInput } from '@/lib/timezone';

describe('formatDateForInput', () => {
  it('writes the midnight hour as 00, which a time input accepts', () => {
    expect(formatDateForInput(new Date('2026-11-21T00:30:00Z'), 'UTC')).toBe('2026-11-21T00:30');
    expect(formatDateForInput(new Date('2026-11-21T00:00:00Z'), 'UTC')).toBe('2026-11-21T00:00');
  });
});
