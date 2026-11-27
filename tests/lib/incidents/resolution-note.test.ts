import { describe, expect, it } from 'vitest';
import { requireResolutionNote } from '@/lib/incidents/resolution-note';

describe('requireResolutionNote', () => {
  it('returns the trimmed note', () => {
    expect(requireResolutionNote('  Rolled back the deploy  ')).toBe('Rolled back the deploy');
  });

  it.each([undefined, null, '', '   ', 'too short'])('refuses %j as too short', value => {
    expect(() => requireResolutionNote(value)).toThrow(/at least 10 characters/);
  });

  it('refuses a note over 1000 characters', () => {
    expect(() => requireResolutionNote('x'.repeat(1001))).toThrow(/1000 characters or fewer/);
    expect(requireResolutionNote('x'.repeat(1000))).toHaveLength(1000);
  });
});
