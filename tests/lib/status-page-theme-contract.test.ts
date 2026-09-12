import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATUS_PAGE_COLORS,
  STATUS_PAGE_COLOR_PRESETS,
  computeStatusPageTheme,
} from '@/lib/status-page-theme';
import {
  DEFAULT_STATUS_PAGE_THEME_ID,
  STATUS_PAGE_THEMES,
  compileStatusPageThemeCss,
  isLegacyStatusPageTemplateCss,
  resolveStatusPageTheme,
} from '@/lib/status-pages/theme-contract';

describe('status page design contract', () => {
  it('keeps the color reset target equal to the native renderer colors', () => {
    expect(DEFAULT_STATUS_PAGE_COLORS).toEqual({
      primary: '#667eea',
      background: '#ffffff',
      text: '#111827',
    });

    // StatusPageConfig uses the first preset for its Reset button. Keep that target explicitly
    // native so "Reset to default" can never mean "Modern Light" again.
    expect(STATUS_PAGE_COLOR_PRESETS[0]).toMatchObject({
      id: 'native-default',
      ...DEFAULT_STATUS_PAGE_COLORS,
    });

    expect(STATUS_PAGE_COLOR_PRESETS.find(preset => preset.id === 'modern-light')).toMatchObject({
      primary: '#4f46e5',
      background: '#f8fafc',
      text: '#0f172a',
    });

    expect(computeStatusPageTheme({})).toMatchObject({
      primaryColor: DEFAULT_STATUS_PAGE_COLORS.primary,
      backgroundColor: DEFAULT_STATUS_PAGE_COLORS.background,
      textColor: DEFAULT_STATUS_PAGE_COLORS.text,
    });
  });

  it('defines Default as the native renderer with no built-in theme CSS', () => {
    expect(resolveStatusPageTheme(undefined).id).toBe(DEFAULT_STATUS_PAGE_THEME_ID);
    expect(compileStatusPageThemeCss(DEFAULT_STATUS_PAGE_THEME_ID)).toBe('');
  });

  it('compiles the selected theme palette into the live V3 token layer', () => {
    const css = compileStatusPageThemeCss('command-center', 'compact');

    expect(css).toContain('OpsKnight Status Page Theme: Command Center v1');
    expect(css).toContain('--sp-page-bg: #111a30');
    expect(css).toContain('--sp-panel-bg: #0b1020');
    expect(css).toContain('--sp-page-text: #f8fafc');
    expect(css).toContain('--sp-theme-accent: #a3e635');
    expect(css).toContain('.status-v3-service');
    expect(css).toContain('.status-v3-incident-pill__summary');
  });

  it('keeps operational status colors outside the decorative theme contract', () => {
    const css = compileStatusPageThemeCss('command-center');

    expect(css).not.toContain('--status-operational:');
    expect(css).not.toContain('--status-degraded:');
    expect(css).not.toContain('--status-major-outage:');
  });

  it('keeps the curated gallery intentionally small and versioned', () => {
    expect(STATUS_PAGE_THEMES).toHaveLength(16);
    expect(new Set(STATUS_PAGE_THEMES.map(theme => theme.id)).size).toBe(16);
    expect(STATUS_PAGE_THEMES.every(theme => theme.version === 1)).toBe(true);
  });

  it('detects old template payloads without classifying ordinary advanced CSS as a template', () => {
    expect(
      isLegacyStatusPageTemplateCss(
        '/* Template: Corporate Blue */\n.status-page-header { background: blue; }'
      )
    ).toBe(true);
    expect(isLegacyStatusPageTemplateCss('.status-page-header { background: blue; }')).toBe(false);
  });
});
