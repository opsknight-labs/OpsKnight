import { describe, expect, it } from 'vitest';
import { replayDigest } from '@/lib/intelligence/squire/chat';

describe('replayDigest', () => {
  it('keeps the first sentence and the sources cited anywhere in the answer', () => {
    const answer =
      'The pool limit is the likely cause (/changes/c1). It dropped from 50 to 10.\n\nSee /runbooks/rb-1 and /incidents/i-9 for the earlier fix; /runbooks/rb-1 worked twice.';
    expect(replayDigest(answer)).toBe(
      'The pool limit is the likely cause (/changes/c1). Sources: /runbooks/rb-1 /incidents/i-9'
    );
  });

  it('returns a one-sentence answer unchanged and bounds a run-on one', () => {
    expect(replayDigest('Answer number 3.')).toBe('Answer number 3.');
    expect(replayDigest('x'.repeat(1_000))).toHaveLength(400);
  });
});
