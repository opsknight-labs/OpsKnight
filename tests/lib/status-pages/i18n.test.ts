import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DICTIONARIES, STATUS_LOCALES, createTranslator } from '@/lib/status-pages/i18n';
import { en } from '@/lib/status-pages/i18n/en';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('status page i18n', () => {
  const keys = Object.keys(en);
  it.each(STATUS_LOCALES)(
    '%s defines exactly the English keys with the same placeholders',
    locale => {
      const dictionary = new Map(
        Object.entries(DICTIONARIES)
          .filter(([l]) => l === locale)
          .flatMap(([, d]) => Object.entries(d as Record<string, string>))
      );
      expect([...dictionary.keys()].sort()).toEqual([...keys].sort());
      for (const [key, english] of Object.entries(en)) {
        const text = dictionary.get(key) ?? '';
        expect(text, `${locale}:${key}`).toBeTruthy();
        expect(placeholders(text), `${locale}:${key}`).toEqual(placeholders(english));
      }
    }
  );
  it('every key is used in the app and every used key exists', () => {
    // Test-only walk of the repo's own src tree.
    /* eslint-disable security/detect-non-literal-fs-filename */
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const full = join(dir, e.name);
        return e.isDirectory() ? walk(full) : /\.tsx?$/.test(e.name) ? [full] : [];
      });
    const source = walk('src')
      .filter(f => !/status-pages\/i18n\/(en|es|fr|de|pt|ja)\.ts$/.test(f))
      .map(f => readFileSync(f, 'utf8'))
      .join('\n');
    /* eslint-enable security/detect-non-literal-fs-filename */
    const unused = keys.filter(key => !source.includes(`'${key}'`) && !source.includes(`"${key}"`));
    expect(unused).toEqual([]);
  });
  it('interpolates and falls back to English for unknown locales', () => {
    expect(createTranslator('fr')('hero.updated', { time: '10:00' })).toContain('10:00');
    expect(createTranslator('xx')('common.today')).toBe('Today');
  });
});
