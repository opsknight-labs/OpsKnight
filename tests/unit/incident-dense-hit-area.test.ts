import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The phone incident page lets controls keep their designed size (chips are 28 or 32px) and gives every control
 * an invisible 44x44 hit area instead. If that rule goes, the controls become 20px targets on a phone: the
 * freshness button measured 19.6px with only the shrink rule in place.
 */
const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('incident page touch targets', () => {
  const coarse = css.slice(
    css.indexOf('@media (hover: none) and (pointer: coarse) {\n  .incident-dense')
  );

  it('shrinks controls only under a coarse pointer, where the hit area replaces their size', () => {
    expect(coarse).toMatch(
      /\.incident-dense\s*:is\([\s\S]*?button[\s\S]*?\)\s*\{[^}]*min-height:\s*0/
    );
  });

  it('gives every control at least a 44 by 44 invisible hit area', () => {
    expect(coarse).toMatch(/::after\s*\{[^}]*width:\s*max\(100%,\s*44px\)/);
    expect(coarse).toMatch(/::after\s*\{[^}]*height:\s*max\(100%,\s*44px\)/);
  });

  it('covers buttons, links, tabs and summary controls', () => {
    for (const control of [
      'button',
      'a',
      'summary',
      "[role='button']",
      "[role='link']",
      "[role='tab']",
    ])
      expect(coarse).toContain(control);
  });
});
