import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const topbar = readFileSync('src/styles/layouts/topbar.css', 'utf8');
const globals = readFileSync('src/app/globals.css', 'utf8');
const authPagesWithDismissibleNotices = {
  'src/app/login/LoginClient.tsx': readFileSync('src/app/login/LoginClient.tsx', 'utf8'),
  'src/app/forgot-password/page.tsx': readFileSync('src/app/forgot-password/page.tsx', 'utf8'),
  'src/app/reset-password/page.tsx': readFileSync('src/app/reset-password/page.tsx', 'utf8'),
};

describe('auth notice dismiss buttons', () => {
  it('has no element-wide button padding override in the shell CSS', () => {
    // A page-wide `button:not(...)` rule used to pad every button (with
    // !important at 1024-1600px), collapsing icon-only buttons to 0px wide.
    // Components own their sizing now; keep it that way.
    expect(topbar).not.toMatch(/^\s*button:not\(/m);
  });

  it('marks every auth notice dismiss button as an icon button', () => {
    for (const [path, source] of Object.entries(authPagesWithDismissibleNotices)) {
      // Each dismiss label, back to the <button that opens it (attributes
      // contain arrow functions, so a [^>]* scan would stop early).
      const openingTags = [...source.matchAll(/aria-label="Dismiss [^"]+"/g)].map(match =>
        source.slice(source.lastIndexOf('<button', match.index), match.index)
      );

      expect(openingTags.length, path).toBeGreaterThan(0);
      for (const tag of openingTags) {
        expect(tag, path).toContain('data-icon-button');
      }
    }
  });

  it('does not force dismiss icon colours globally', () => {
    // A blanket white-X override painted invisible icons on light surfaces
    // whenever the OS or a stored preference disagreed with the painted theme.
    expect(globals).not.toMatch(/button\[aria-label\*=["']Dismiss["']\]/);
  });
});
