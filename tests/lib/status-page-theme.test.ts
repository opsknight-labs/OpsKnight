import { describe, it, expect } from 'vitest';
import {
  isDarkHex,
  resolveStatusPageFontFamily,
  computeStatusPageTheme,
  STATUS_PAGE_FONTS,
  STATUS_PAGE_COLOR_PRESETS,
} from '@/lib/status-page-theme';

describe('status-page-theme utility', () => {
  describe('isDarkHex', () => {
    it('correctly identifies dark colors', () => {
      expect(isDarkHex('#000000')).toBe(true);
      expect(isDarkHex('#0f172a')).toBe(true); // slate 900
      expect(isDarkHex('#18181b')).toBe(true); // zinc 900
      expect(isDarkHex('#1e293b')).toBe(true); // slate 800
      expect(isDarkHex('#030712')).toBe(true); // gray 950
      expect(isDarkHex('000')).toBe(true);
    });

    it('correctly identifies light colors', () => {
      expect(isDarkHex('#ffffff')).toBe(false);
      expect(isDarkHex('#f8fafc')).toBe(false);
      expect(isDarkHex('#f0f9ff')).toBe(false);
      expect(isDarkHex('#fffbf5')).toBe(false);
      expect(isDarkHex('fff')).toBe(false);
    });

    it('handles invalid or empty input safely', () => {
      expect(isDarkHex('')).toBe(false);
      expect(isDarkHex(null)).toBe(false);
      expect(isDarkHex(undefined)).toBe(false);
      expect(isDarkHex('invalid-hex')).toBe(false);
    });
  });

  describe('resolveStatusPageFontFamily', () => {
    it('returns default font stack when no font id is specified', () => {
      const resolved = resolveStatusPageFontFamily(null);
      expect(resolved).toBe(STATUS_PAGE_FONTS[0].fontFamily);
    });

    it('resolves curated font ids to full font stacks', () => {
      const inter = resolveStatusPageFontFamily('inter');
      expect(inter).toContain('Inter');

      const mono = resolveStatusPageFontFamily('mono');
      expect(mono).toContain('JetBrains Mono');

      const serif = resolveStatusPageFontFamily('serif');
      expect(serif).toContain('Charter');
    });

    it('passes through custom font stacks if not in predefined list', () => {
      const custom = 'MyCustomFont, sans-serif';
      expect(resolveStatusPageFontFamily(custom)).toBe(custom);
    });
  });

  describe('computeStatusPageTheme', () => {
    it('computes clean light theme with CSS variables', () => {
      const theme = computeStatusPageTheme({
        primaryColor: '#4f46e5',
        backgroundColor: '#f8fafc',
        textColor: '#0f172a',
        fontFamily: 'inter',
      });

      expect(theme.isDark).toBe(false);
      expect(theme.primaryColor).toBe('#4f46e5');
      expect(theme.backgroundColor).toBe('#f8fafc');
      expect(theme.textColor).toBe('#0f172a');
      expect(theme.fontFamily).toContain('Inter');
      expect(theme.cssVariables['--status-primary']).toBe('#4f46e5');
      expect(theme.cssVariables['--primary']).toBe('#4f46e5');
      expect(theme.cssVariables['--status-bg']).toBe('#f8fafc');
      expect(theme.cssVariables['--status-text']).toBe('#0f172a');
    });

    it('automatically prevents white-on-white text collision on dark background', () => {
      // User set background to dark #0f172a, but forgot to change dark text #111827
      const theme = computeStatusPageTheme({
        primaryColor: '#10b981',
        backgroundColor: '#0f172a',
        textColor: '#111827', // dark text on dark bg!
      });

      expect(theme.isDark).toBe(true);
      // Safeguard automatically switches text to readable light
      expect(theme.textColor).toBe('#f8fafc');
      expect(theme.cssVariables['--status-text']).toBe('#f8fafc');
      expect(theme.cssVariables['--status-panel-bg']).toContain('color-mix');
    });

    it('automatically prevents dark-on-dark collision when light bg paired with light text', () => {
      const theme = computeStatusPageTheme({
        primaryColor: '#3b82f6',
        backgroundColor: '#ffffff',
        textColor: '#ffffff', // white text on white bg!
      });

      expect(theme.isDark).toBe(false);
      expect(theme.textColor).toBe('#111827');
    });

    it('provides all predefined color presets', () => {
      expect(STATUS_PAGE_COLOR_PRESETS.length).toBeGreaterThanOrEqual(4);
      for (const preset of STATUS_PAGE_COLOR_PRESETS) {
        expect(preset.primary).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(preset.background).toMatch(/^#[0-9a-fA-F]{6}$/);
        expect(preset.text).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    });
  });
});
