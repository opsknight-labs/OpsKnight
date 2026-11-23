import { describe, expect, it } from 'vitest';
import { recurrenceLabel } from '@/components/incident/detail/DedupRecurrenceChip';

const at = new Date('2026-11-23T12:00:00Z');
const before = (ms: number) => new Date(at.getTime() - ms);

describe('recurrenceLabel', () => {
  it('names the gap since this dedup key last opened an incident', () => {
    expect(recurrenceLabel(at, null)).toBe('first time');
    expect(recurrenceLabel(at, before(41 * 86_400_000 + 5_000))).toBe('first in 41 days');
    expect(recurrenceLabel(at, before(86_400_000))).toBe('first in 1 day');
    expect(recurrenceLabel(at, before(3 * 3_600_000 + 1))).toBe('again after 3 h');
    expect(recurrenceLabel(at, before(20_000))).toBe('again after 1 min');
  });
});
