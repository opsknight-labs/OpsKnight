import { describe, expect, it } from 'vitest';
import {
  formatFiveWhys,
  parseStoredFactors,
  parseStoredFiveWhys,
} from '@/components/postmortem/root-cause-format';

const strip = (steps: { question: string; answer: string }[]) =>
  steps.map(({ question, answer }) => ({ question, answer }));

describe('postmortem root-cause format', () => {
  it('round-trips five whys without merging the question into the answer', () => {
    const steps = [
      { id: 'a', question: 'Why did the API fail?', answer: 'The DB pool - all 50 - was exhausted' },
      { id: 'b', question: 'Why was the pool exhausted?', answer: 'A leak in v2.3: missing release' },
      { id: 'c', question: '', answer: 'Answer only' },
      { id: 'd', question: 'Question only', answer: '' },
    ];
    const once = parseStoredFiveWhys(`Narrative\n\n### 5-Whys Analysis\n${formatFiveWhys(steps)}`);
    expect(strip(once)).toEqual(strip(steps));
    // A second save must not nest further.
    expect(strip(parseStoredFiveWhys(formatFiveWhys(once)))).toEqual(strip(steps));
  });

  it('reads only explicitly chosen factors, never keyword guesses', () => {
    expect(parseStoredFactors('The database server ran out of memory after a deploy')).toEqual([]);
    expect(parseStoredFactors('x\n\n[Contributing Factors: PROCESS, MONITORING_GAP]')).toEqual([
      'PROCESS',
      'MONITORING_GAP',
    ]);
  });
});
