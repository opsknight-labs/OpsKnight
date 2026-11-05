import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createElement, type ComponentType } from 'react';
import { describe, expect, it } from 'vitest';
import { renderEmail } from '@/emails/render';
import { SURFACE, TONES } from '@/emails/tokens';

/**
 * Email contract: every OpsKnight email is built from src/emails and renders correctly in
 * Outlook desktop (Word), new Outlook / Outlook.com, Gmail, Apple Mail and Yahoo, in light
 * and dark mode. See AGENTS.md §6 "Email & Transactional Notification Standards".
 */

const TEMPLATE_DIR = join(process.cwd(), 'src/emails/templates');
const templateFiles = readdirSync(TEMPLATE_DIR).filter(file => file.endsWith('.tsx'));

type TemplateModule = {
  default: ComponentType<Record<string, unknown>> & { PreviewProps?: Record<string, unknown> };
};

async function renderTemplate(file: string) {
  const mod = (await import(`@/emails/templates/${basename(file, '.tsx')}`)) as TemplateModule;
  const Template = mod.default;
  return renderEmail(createElement(Template, Template.PreviewProps ?? {}));
}

// ─── WCAG contrast ─────────────────────────────────────────────────────────
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('email contract: every template', () => {
  it('has a default export with preview props for `npm run email:dev`', async () => {
    expect(templateFiles.length).toBeGreaterThanOrEqual(14);
    for (const file of templateFiles) {
      const mod = (await import(`@/emails/templates/${basename(file, '.tsx')}`)) as TemplateModule;
      expect(typeof mod.default, file).toBe('function');
      expect(mod.default.PreviewProps, `${file} PreviewProps`).toBeDefined();
    }
  });

  it.each(templateFiles)('%s renders client-safe HTML', async file => {
    const { html, text } = await renderTemplate(file);

    // Gmail clips messages over 102 KB ("[Message clipped]"), hiding footers and unsubscribe.
    expect(Buffer.byteLength(html, 'utf8'), 'HTML size').toBeLessThan(102 * 1024);

    // Word engine: no SVG, flex/grid, positioning; React's leftover wrapper is stripped.
    expect(html).not.toMatch(/<svg/i);
    expect(html).not.toMatch(/display:\s*(inline-)?(flex|grid)/);
    expect(html).not.toMatch(/position:\s*(absolute|relative|fixed)/);
    expect(html).not.toContain('opsknight-raw');

    // Every gradient is progressive enhancement over a solid Outlook fill.
    for (const match of html.matchAll(/<td[^>]*linear-gradient[^>]*>/g))
      expect(match[0], 'gradient without bgcolor').toMatch(/bgcolor="#[0-9a-f]{6}"/i);
    expect(html).not.toMatch(/style="background:\s*linear-gradient/);

    // Bulletproof CTAs: one VML roundrect per non-Outlook link button.
    const vml = html.match(/<v:roundrect/g)?.length ?? 0;
    const nonMso = html.match(/<!--\[if !mso\]><!-->/g)?.length ?? 0;
    expect(vml).toBe(nonMso);

    // Images: absolute URL, explicit size and alt text; no data: URIs (blocked by Gmail/Outlook).
    for (const img of html.matchAll(/<img[^>]*>/g)) {
      expect(img[0]).toMatch(/src="https?:\/\//);
      expect(img[0]).toMatch(/width="\d+"/);
      expect(img[0]).toMatch(/height="\d+"/);
      expect(img[0]).toMatch(/alt="[^"]+"/);
    }
    expect(html).not.toContain('src="data:');

    // Dark mode: declared schemes + media query + Outlook.com attribute selectors.
    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).toContain('@media (prefers-color-scheme:dark)');
    expect(html).toContain('[data-ogsc]');
    expect(html).toContain('[data-ogsb]');

    // Outlook fonts and fixed width.
    expect(html).toContain("font-family:'Segoe UI',Arial,sans-serif!important");
    expect(html).toContain('width="640"');

    // Inbox preheader and a real plain-text alternative.
    expect(html).toContain('data-skip-in-text="true"');
    expect(text.trim().length).toBeGreaterThan(40);
  });
});

describe('email contract: palette accessibility', () => {
  it('CTA and badge fills meet WCAG AA with white text', () => {
    for (const [tone, t] of Object.entries(TONES))
      expect(contrast(t.button, '#ffffff'), `${tone} button`).toBeGreaterThanOrEqual(4.5);
  });

  it('callout text meets WCAG AA on its tinted surface in light and dark mode', () => {
    for (const [tone, t] of Object.entries(TONES)) {
      expect(contrast(t.ink, t.soft), `${tone} light`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.inkDark, t.softDark), `${tone} dark`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('body, heading and muted text meet WCAG AA on cards in both modes', () => {
    for (const mode of [SURFACE.light, SURFACE.dark]) {
      expect(contrast(mode.heading, mode.card)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(mode.body, mode.card)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(mode.muted_text, mode.card)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(mode.muted_text, mode.page)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(mode.link, mode.card)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('status ramps match the AGENTS.md status colour semantics', () => {
    const agents = readFileSync('AGENTS.md', 'utf8');
    const ramps: Array<[keyof typeof TONES, string]> = [
      ['critical', 'Critical / Triggered / High Urgency'],
      ['elevated', 'Elevated / Medium Urgency / Acknowledged'],
      ['ok', 'Resolved / Operational / Success'],
      ['info', 'Standard / Low Urgency / Info'],
      ['shift', 'On-Call Shifts & Rotations'],
    ];
    for (const [tone, heading] of ramps) {
      const line = agents.split('\n').find(l => l.includes(`**${heading}**`));
      const [deep, base, border, soft] = [...(line ?? '').matchAll(/#[0-9a-f]{6}/gi)].map(m =>
        m[0].toLowerCase()
      );
      const t = new Map(Object.entries(TONES)).get(tone)!;
      expect({ deep: t.deep, base: t.base, border: t.border, soft: t.soft }, tone).toEqual({
        deep,
        base,
        border,
        soft,
      });
    }
  });
});

// eslint-disable-next-line security/detect-non-literal-fs-filename -- repo paths from git ls-files
const readSource = (file: string) => readFileSync(file, 'utf8');

describe('email contract: every email goes through src/emails', () => {
  const sources = execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
    .split('\n')
    .filter(file => /\.(ts|tsx)$/.test(file) && !file.startsWith('src/emails/'));

  it('no product code hand-builds email documents', () => {
    const offenders = sources.filter(file => {
      const source = readSource(file);
      return /<!DOCTYPE html/i.test(source) && /kind: 'EMAIL'|sendEmail\(/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it('no EMAIL payload carries an inline HTML literal', () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const source = readSource(file);
      if (!/kind: 'EMAIL'/.test(source)) continue;
      if (/html:\s*`\s*</.test(source)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('every EMAIL payload sends HTML (templates or fan-out content), not text alone', () => {
    const offenders: string[] = [];
    for (const file of sources) {
      const source = readSource(file);
      for (const match of source.matchAll(/payload:\s*\{\s*kind: 'EMAIL',[\s\S]*?\n\s{0,14}\},/g)) {
        // `...template` spreads a rendered { subject, html, text }.
        if (!/\bhtml\b|contentId|\.\.\.\w+/.test(match[0])) offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
