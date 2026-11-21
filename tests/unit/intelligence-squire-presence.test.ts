import { describe, expect, it } from 'vitest';
import { squirePresence, type SquirePresenceInput } from '@/components/squire/presence';
const ready: SquirePresenceInput = {
  online: true,
  greeting: false,
  busy: false,
  speaking: false,
  typing: false,
  failed: false,
  outcome: null,
  attention: false,
  availability: 'ready',
};
describe('truthful Squire expressions', () => {
  it.each([
    [{}, 'idle'],
    [{ greeting: true }, 'greeting'],
    [{ typing: true }, 'listening'],
    [{ typing: true, failed: true }, 'listening'],
    [{ failed: true, availability: 'quota' }, 'offline'],
    [{ busy: true }, 'thinking'],
    [{ busy: true, speaking: true }, 'speaking'],
    [{ outcome: 'success' }, 'success'],
    [{ attention: true }, 'alert'],
    [{ failed: true }, 'error'],
    [{ online: false }, 'offline'],
  ] as const)('maps %j to %s', (input, state) =>
    expect(squirePresence({ ...ready, ...input }).state).toBe(state)
  );
  it('wakes for basic answers despite AI being disabled or quota exhausted', () => {
    for (const availability of ['disabled', 'quota', 'unavailable'] as const) {
      expect(squirePresence({ ...ready, availability }).state).toBe('offline');
      expect(squirePresence({ ...ready, availability }).label).toContain('basic mode available');
      expect(squirePresence({ ...ready, availability, busy: true }).state).toBe('thinking');
      expect(squirePresence({ ...ready, availability, busy: true, speaking: true }).state).toBe(
        'speaking'
      );
    }
  });
  it('prioritizes a confirmed action result and network loss over stale attention', () => {
    expect(squirePresence({ ...ready, attention: true, outcome: 'success' }).state).toBe('success');
    expect(squirePresence({ ...ready, online: false, busy: true, speaking: true }).state).toBe(
      'offline'
    );
  });
});
