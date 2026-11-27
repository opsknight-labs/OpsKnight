import { describe, expect, it } from 'vitest';
import { toneClasses, type ToneKey } from '@/components/patterns/status-tone';

/**
 * A chip's text colour must say what it is in dark mode too. The neutral chip once used a fixed light-mode
 * ink colour, which measured 1.96:1 on the dark fill (every "deploy" or label chip was close to unreadable).
 */
const TONES: ToneKey[] = ['critical', 'elevated', 'ok', 'info', 'shift', 'orange', 'neutral'];

describe('soft status chips', () => {
  it.each(TONES)('%s names its own text colour for dark mode', tone => {
    expect(toneClasses(tone).soft).toMatch(/\bdark:text-/);
  });

  it('keeps the neutral chip off the theme-blind ink colour in dark mode', () => {
    const soft = toneClasses('neutral').soft;
    expect(soft).toContain('dark:text-zinc-300');
  });
});
