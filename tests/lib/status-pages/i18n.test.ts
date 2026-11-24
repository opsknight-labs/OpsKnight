import { describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import { DICTIONARIES, STATUS_LOCALES, createTranslator } from '@/lib/status-pages/i18n';
import { en } from '@/lib/status-pages/i18n/en';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe('status page i18n', () => {
  const keys = Object.keys(en);
  it.each(STATUS_LOCALES)(
    '%s defines exactly the English keys with the same placeholders',
    locale => {
      const dictionary = DICTIONARIES[locale] as Record<string, string>;
      expect(Object.keys(dictionary).sort()).toEqual([...keys].sort());
      for (const key of keys) {
        expect(dictionary[key], `${locale}:${key}`).toBeTruthy();
        expect(placeholders(dictionary[key]), `${locale}:${key}`).toEqual(
          placeholders((en as Record<string, string>)[key])
        );
      }
    }
  );
  it('every key is used in the app and every used key exists', () => {
    const files = execSync(
      'grep -rlE "([\'\\"])(status|hero|filter|services|business|incidents|common|embed|incident|history|subscribe)\\.[A-Za-z0-9]+\\1" src --include=*.ts --include=*.tsx || true',
      { encoding: 'utf8' }
    )
      .split('\n')
      .filter(f => f && !/status-pages\/i18n\/(en|es|fr|de|pt|ja)\.ts$/.test(f));
    const source = files.map(f => execSync(`cat "${f}"`, { encoding: 'utf8' })).join('\n');
    const unused = keys.filter(key => !source.includes(`'${key}'`) && !source.includes(`"${key}"`));
    expect(unused).toEqual([]);
  });
  it('interpolates and falls back to English for unknown locales', () => {
    expect(createTranslator('fr')('hero.updated', { time: '10:00' })).toContain('10:00');
    expect(createTranslator('xx')('common.today')).toBe('Today');
  });
});
