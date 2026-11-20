import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import PublicStatusLayout from '@/app/(public)/status/layout';
import { FORCE_LIGHT_THEME_SCRIPT } from '@/lib/theme-preference';
import { STATUS_PAGE_PUBLIC_CSS, STATUS_PAGE_SURFACE_CLASS } from '@/lib/status-pages/public-css';

// Theme tokens live in one source (tokens.css).
const indexCss = readFileSync('src/styles/foundation/tokens.css', 'utf8');
const baseCss = readFileSync('src/styles/foundation/base.css', 'utf8');

/** Body of the first `{ ... }` block that follows `selector` (no nested braces inside). */
function blockAfter(css: string, selector: string): string {
  const start = css.indexOf(selector);
  expect(start, `selector ${selector}`).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  return css.slice(open + 1, css.indexOf('}', open));
}

/** `--ui-*` custom properties declared in a block, keyed without the prefix. */
function uiTokens(block: string): Map<string, string> {
  return new Map(
    [...block.matchAll(/--ui-([\w-]+):\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()])
  );
}

function hslToken(block: string, name: string): [number, number, number] {
  const match = uiTokens(block)
    .get(name)
    ?.match(/^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  expect(match, `--ui-${name}`).toBeTruthy();
  return [Number(match![1]), Number(match![2]) / 100, Number(match![3]) / 100];
}

function luminance([h, s, l]: [number, number, number]): number {
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(8) + 0.0722 * channel(4);
}

function contrast(block: string, fg: string, bg: string): number {
  const [hi, lo] = [luminance(hslToken(block, fg)), luminance(hslToken(block, bg))].sort(
    (x, y) => y - x
  );
  return (hi + 0.05) / (lo + 0.05);
}

describe('destructive token contrast (WCAG AA, 4.5:1)', () => {
  const light = blockAfter(indexCss, ':root {');
  const dark = blockAfter(indexCss, ".dark,\n[data-theme='dark'] {");

  it('sanity-checks the contrast maths against known pairs', () => {
    expect(contrast('--ui-a: 0 0% 0%; --ui-b: 0 0% 100%;', 'a', 'b')).toBeCloseTo(21, 5);
    expect(contrast('--ui-a: 0 0% 50%; --ui-b: 0 0% 50%;', 'a', 'b')).toBeCloseTo(1, 5);
  });

  it.each(['background', 'card', 'muted'])('dark destructive reads on dark %s', surface => {
    expect(contrast(dark, 'destructive', surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('dark destructive-foreground reads on a filled destructive', () => {
    expect(contrast(dark, 'destructive-foreground', 'destructive')).toBeGreaterThanOrEqual(4.5);
  });

  // Light --ui-destructive darkened to 48% lightness so it clears 4.5:1 on --ui-background.
  it('light destructive reads on the light background', () => {
    expect(contrast(light, 'destructive', 'background')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('light-only status surface', () => {
  it('renders the force-light script ahead of the status page content', () => {
    const html = renderToStaticMarkup(
      PublicStatusLayout({ children: <main id="status-content" /> })
    );
    const script = `<script>${FORCE_LIGHT_THEME_SCRIPT}</script>`;
    expect(html).toContain(script);
    expect(html.indexOf(script)).toBeLessThan(html.indexOf('status-content'));
  });
});

describe('public status page CSS follows the page theme only', () => {
  it('does not react to the visitor OS or the console theme', () => {
    expect(STATUS_PAGE_PUBLIC_CSS).not.toContain('prefers-color-scheme');
    expect(STATUS_PAGE_PUBLIC_CSS).not.toContain('.dark .');
    expect(STATUS_PAGE_SURFACE_CLASS).toBe('status-page-surface');
    expect(STATUS_PAGE_PUBLIC_CSS).not.toMatch(
      /\[data-theme=["']dark["']\]\s*\.status-page-surface/
    );
  });

  it('keys dark widget styles off the surface attribute', () => {
    expect(STATUS_PAGE_PUBLIC_CSS).toContain(
      `.${STATUS_PAGE_SURFACE_CLASS}[data-surface-theme="dark"]`
    );
  });
});

describe('base.css dark-mode contract', () => {
  it('does not invert native date/time picker icons', () => {
    for (const rule of baseCss.match(/[^{}]*calendar-picker-indicator[^{}]*\{[^}]*\}/g) ?? []) {
      expect(rule).not.toMatch(/invert/);
    }
  });

  it('prints the light palette even when the screen theme is dark', () => {
    const print = baseCss.slice(baseCss.indexOf('@media print'));
    const reset = blockAfter(print, "html.dark,\n    html[data-theme='dark'] {");
    expect(reset).toMatch(/color-scheme:\s*light/);
    // Every --ui-* token the print reset sets must equal the light :root value.
    const light = uiTokens(blockAfter(indexCss, ':root {'));
    const printed = uiTokens(reset);
    expect(printed.has('foreground')).toBe(true);
    for (const [name, value] of printed) expect(value, `--ui-${name}`).toBe(light.get(name));
  });
});
