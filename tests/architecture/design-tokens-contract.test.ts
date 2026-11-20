import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tailwindConfig from '../../tailwind.config';
import { TYPE_SCALE_STEPS } from '@/lib/design/type-scale';

/**
 * Pins the single token source described in DESIGN.md: every scale is defined
 * once in src/styles/foundation/tokens.css, loaded first, and Tailwind reads the
 * same variables.
 */

const TOKENS = 'src/styles/foundation/tokens.css';

// eslint-disable-next-line security/detect-non-literal-fs-filename -- repo-relative paths from git ls-files / literals
const read = (path: string) => readFileSync(path, 'utf8');
// eslint-disable-next-line security/detect-non-literal-fs-filename -- repo-relative paths from git ls-files / literals
const exists = (path: string) => existsSync(path);

const tokens = read(TOKENS);

function trackedCss(): string[] {
  return execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', 'src'],
    {
      encoding: 'utf8',
    }
  )
    .split('\0')
    .filter(file => file.endsWith('.css') && exists(file));
}

function bodyRule(css: string): string {
  return /(?:^|\n)body\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
}

describe('design tokens contract', () => {
  it('loads tokens.css before every other stylesheet', () => {
    expect(exists(TOKENS)).toBe(true);
    const imports = [...read('src/styles/index.css').matchAll(/@import\s+['"]([^'"]+)['"]/g)].map(
      m => m[1]
    );
    expect(imports[0]).toBe('./foundation/tokens.css');
  });

  it('backs every Tailwind font size with the CSS type-scale variable of the same name', () => {
    const cssSteps = [...tokens.matchAll(/--font-size-([0-9a-z]+):\s*([^;]+);/g)].map(m => m[1]);
    const fontSize = new Map(
      Object.entries(tailwindConfig.theme?.extend?.fontSize as Record<string, unknown>)
    );

    expect([...fontSize.keys()]).toEqual([...TYPE_SCALE_STEPS]);
    expect(cssSteps).toEqual([...TYPE_SCALE_STEPS]);
    for (const step of TYPE_SCALE_STEPS) {
      expect(fontSize.get(step)).toEqual([
        `var(--font-size-${step})`,
        {
          lineHeight: `var(--font-size-${step}--line-height)`,
          letterSpacing: `var(--font-size-${step}--letter-spacing)`,
        },
      ]);
      expect(tokens).toContain(`--font-size-${step}--line-height:`);
      expect(tokens).toContain(`--font-size-${step}--letter-spacing:`);
    }
  });

  it('keeps the type scale ascending in rem', () => {
    const sizes = new Map(
      [...tokens.matchAll(/--font-size-([0-9a-z]+):\s*([\d.]+)rem;/g)].map(m => [
        m[1],
        Number(m[2]),
      ])
    );
    const ordered = TYPE_SCALE_STEPS.map(step => sizes.get(step) ?? Number.NaN);
    expect(ordered.every(Number.isFinite)).toBe(true);
    expect([...ordered].sort((a, b) => a - b)).toEqual(ordered);
    expect(new Set(ordered).size).toBe(ordered.length);
  });

  it('defines radius, shadow, type, motion and z-index values only in tokens.css (aliases allowed)', () => {
    const scaleVar =
      /(--(?:ui-)?radius[\w-]*|--shadow-[\w-]+|--font-size-[\w-]+|--transition-[\w-]+|--z-[\w-]+)\s*:\s*([^;]+);/g;
    const offenders: string[] = [];
    for (const file of trackedCss()) {
      if (file === TOKENS) continue;
      for (const [, name, value] of read(file).matchAll(scaleVar)) {
        if (!value.trim().startsWith('var(')) offenders.push(`${file}: ${name}: ${value.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('sets body text to weight 400 and leaves emphasis to explicit classes', () => {
    expect(tokens).toMatch(/--font-weight-normal:\s*400;/);
    const body = bodyRule(read('src/styles/foundation/base.css'));
    expect(body).toMatch(/font-weight:\s*var\(--font-weight-normal\);/);
    expect(bodyRule(read('src/app/globals.css'))).not.toMatch(/font-weight/);
  });

  it('drives the root font size from the documented density mechanism only', () => {
    expect(tokens).toMatch(/html\s*\{\s*font-size:\s*calc\(16px \* var\(--density-scale\)\);/);
    expect(tokens).toContain("html[data-density='compact']");
    expect(tokens).toContain("html[data-density='comfortable']");
    for (const file of trackedCss().filter(f => f !== TOKENS)) {
      expect(read(file), file).not.toMatch(/(^|\n)\s*html\s*\{[^}]*font-size/);
    }
    expect(read('DESIGN.md')).toContain('data-density');
  });
});
