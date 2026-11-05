import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATUS_PALETTE, type StatusTone } from '@/lib/design/status-palette';
import { OPSKNIGHT_BRAND_URL } from '@/lib/brand';

/**
 * Guards the brand & design-system standard in AGENTS.md §3
 * ("Brand Identity & Design System Standards") so the UI cannot drift from it.
 */

// eslint-disable-next-line security/detect-non-literal-fs-filename -- repo-relative paths from git ls-files / literals
const read = (path: string) => readFileSync(path, 'utf8');

function trackedSourceFiles(pattern: RegExp): string[] {
  return execFileSync('git', ['ls-files', '-z', 'src'], { encoding: 'utf8' })
    .split('\0')
    .filter(file => pattern.test(file));
}

// Transactional email HTML cannot load bundled web fonts, so it names families directly.
const EMAIL_SOURCES =
  /^src\/lib\/(email[^/]*|[^/]*-email-templates?|[^/]*email-template)\.ts$|^src\/lib\/(email|notifications?)\//;

describe('design system contract: typography', () => {
  it('bundles Inter and Space Grotesk as the only app typefaces', () => {
    const layout = read('src/app/layout.tsx');
    expect(layout).toContain("'./fonts/Inter-latin-normal.woff2'");
    expect(layout).toContain("'./fonts/SpaceGrotesk-latin.woff2'");
    expect(layout).toContain("variable: '--font-inter'");
    expect(layout).toContain("variable: '--font-space-grotesk'");
    expect(layout).not.toMatch(/Manrope|Playfair|fonts\.googleapis/);
    // Variables must sit on <html> so :root-level font tokens can resolve them.
    expect(layout).toMatch(
      /<html[\s\S]*?className=\{`\$\{inter\.variable\} \$\{spaceGrotesk\.variable\}`\}/
    );
  });

  it('ships the SIL OFL notice for every bundled typeface', () => {
    const tracked = execFileSync('git', ['ls-files', 'src/app/fonts'], { encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
    for (const family of ['Inter', 'SpaceGrotesk']) {
      expect(tracked, family).toContain(`src/app/fonts/${family}-OFL.txt`);
      const notice = read(`src/app/fonts/${family}-OFL.txt`);
      expect(notice).toMatch(/^Copyright /);
      expect(notice).toContain('SIL OPEN FONT LICENSE Version 1.1');
    }
  });

  it('defines one font token per role and wires Tailwind to it', () => {
    const variables = read('src/styles/foundation/variables.css');
    expect(variables).toMatch(/--font-family-sans: var\(--font-inter\), 'Inter'/);
    expect(variables).toMatch(
      /--font-family-display: var\(--font-space-grotesk\), 'Space Grotesk'/
    );

    const tailwind = read('tailwind.config.ts');
    expect(tailwind).toContain("sans: ['var(--font-family-sans)']");
    expect(tailwind).toContain("display: ['var(--font-family-display)']");
  });

  it('never hard-codes retired or literal font families in UI code', () => {
    const offenders: string[] = [];
    for (const file of trackedSourceFiles(/\.(tsx?|css)$/)) {
      if (EMAIL_SOURCES.test(file)) continue;
      const source = read(file);
      if (/Manrope|Montserrat|Playfair|font-manrope|font-serif/.test(source)) {
        offenders.push(`${file}: retired font`);
      }
      if (/font-\['(Space_Grotesk|Inter)/.test(source)) {
        offenders.push(`${file}: arbitrary font class (use font-display / font-sans)`);
      }
      if (/font-family:\s*['"]?(Space Grotesk|Inter)\b/.test(source)) {
        offenders.push(
          `${file}: literal font-family (use --font-family-display / --font-family-sans)`
        );
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('design system contract: logo', () => {
  it('never encloses the logo in a dark filled box', () => {
    const offenders: string[] = [];
    for (const file of trackedSourceFiles(/\.tsx$/)) {
      const lines = read(file).split('\n');
      lines.forEach((line, index) => {
        if (!/["'`]\/logo\.(png|svg)["'`]/.test(line)) return;
        const context = lines.slice(Math.max(0, index - 8), index).join('\n');
        if (/bg-(slate|gray|zinc|neutral|stone)-(8|9)\d\d|bg-black\b|#0f172a/i.test(context)) {
          offenders.push(`${file}:${index + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('uses the shared lockups on sign-in and setup, linked to opsknight.com', () => {
    expect(OPSKNIGHT_BRAND_URL).toBe('https://opsknight.com/');
    expect(read('src/components/auth/AuthBrand.tsx')).toContain('href={OPSKNIGHT_BRAND_URL}');
    for (const file of [
      'src/app/login/LoginClient.tsx',
      'src/app/setup/page.tsx',
      'src/components/auth/LoginAnimation.tsx',
      'src/app/oauth/mcp/consent/ConsentView.tsx',
      'src/app/oauth/mcp/consent/result/page.tsx',
      'src/app/oauth/mcp/device/DeviceView.tsx',
    ]) {
      expect(read(file), file).toContain('<AuthBrand');
      // The lockup is not rebuilt by hand next to the shared component.
      expect(read(file), file).not.toContain('src="/logo.png"');
    }
  });
});

describe('design system contract: status colour semantics', () => {
  const agents = read('AGENTS.md');
  const documented: Array<[StatusTone, string]> = [
    ['critical', 'Critical / Triggered / High Urgency'],
    ['elevated', 'Elevated / Medium Urgency / Acknowledged'],
    ['ok', 'Resolved / Operational / Success'],
    ['info', 'Standard / Low Urgency / Info'],
    ['shift', 'On-Call Shifts & Rotations'],
  ];

  it.each(documented)('%s tone matches the AGENTS.md hex values', (tone, heading) => {
    const line = agents.split('\n').find(l => l.includes(`**${heading}**`));
    expect(line, heading).toBeDefined();
    const [deep, base, border, soft] = [...line!.matchAll(/#[0-9a-f]{6}/gi)].map(m =>
      m[0].toLowerCase()
    );
    expect(new Map(Object.entries(STATUS_PALETTE)).get(tone)).toEqual({ deep, base, border, soft });
  });

  it('exposes the palette to Tailwind', () => {
    const tailwind = read('tailwind.config.ts');
    expect(tailwind).toContain("from './src/lib/design/status-palette'");
    expect(tailwind).toContain('status: STATUS_TAILWIND_COLORS');
  });

  it('uses emerald, not Tailwind green, for success in UI code', () => {
    // Allowed: third-party brand colour (WhatsApp) and terminal syntax highlighting.
    const allowed = new Set([
      'src/components/users/UserDetailTabs.tsx',
      'src/app/(app)/services/[id]/page.tsx',
    ]);
    const offenders = trackedSourceFiles(/\.tsx?$/)
      .filter(file => !allowed.has(file) && !EMAIL_SOURCES.test(file))
      .filter(file =>
        /\b(bg|text|border(-[lrtb])?|ring|from|to|via|fill|stroke)-green-\d{2,3}\b/.test(read(file))
      );
    expect(offenders).toEqual([]);
  });

  it('keeps incident-state hues out of on-call layer colours', () => {
    const timeline = read('src/components/ScheduleTimeline.tsx');
    const layerColors = timeline.slice(
      timeline.indexOf('const LAYER_COLORS'),
      timeline.indexOf('];', timeline.indexOf('const LAYER_COLORS'))
    );
    expect(layerColors).toContain('violet');
    expect(layerColors).not.toMatch(/-(rose|red|amber|orange|emerald|green)-/);
  });
});
