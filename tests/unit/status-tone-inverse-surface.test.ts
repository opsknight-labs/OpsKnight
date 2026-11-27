import { describe, expect, it } from 'vitest';
import { toneClasses } from '@/components/patterns/status-tone';

/**
 * The neutral chip takes its fill from the theme tokens (bg-muted), which turn dark inside an always-dark
 * inverse surface such as a page hero, while the ink ramp stays at its light-theme values there. Left alone
 * its slate text measured 1.96:1 on the dark fill (the change page's "deploy" chip, axe).
 */
describe('the neutral status chip', () => {
  it('names a light text colour for the always-dark inverse surface', () => {
    expect(toneClasses('neutral').soft).toContain('[.ok-inverse-surface_&]:text-zinc-300');
  });

  it('keeps its theme-aware ink text elsewhere', () => {
    expect(toneClasses('neutral').soft).toMatch(/\btext-ink-600\b/);
  });

  it('is the only tone that borrows a theme token for its fill', () => {
    // The tinted tones carry their own fill, so their contrast does not depend on the surface they sit on.
    for (const tone of ['critical', 'elevated', 'ok', 'info', 'shift', 'orange'] as const)
      expect(toneClasses(tone).soft).not.toMatch(/\bbg-muted\b/);
  });
});
