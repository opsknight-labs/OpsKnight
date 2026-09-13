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
    expect(css).toContain('--sp-theme-accent-contrast: #0b1020');
    expect(css).toContain('.status-v3-service');
    expect(css).toContain('.status-v3-incident-pill__summary');
  });

  it('hardens dark themes against inherited light branding tokens', () => {
    const css = compileStatusPageThemeCss('command-center');

    expect(resolveStatusPageTheme('command-center').mode).toBe('dark');
    expect(css).toContain('.status-page-container .status-page-surface');
    expect(css).toContain('color-scheme: dark');
    expect(css).toContain('--sp-ink: #f8fafc');
    expect(css).toContain('--status-primary: var(--sp-theme-accent)');
    expect(css).toContain('--primary: var(--sp-theme-accent)');
    expect(css).toContain('--status-operational: #6ee7b7');
    expect(css).toContain('--status-operational-bg: color-mix');
    expect(css).toContain('--status-major-outage: #fda4af');
    expect(css).toContain('.status-topbar__chip--accent');
    expect(css).toContain('.status-subscribe__button');
  });

  it('bridges dark curated palettes into the V3 service-card token layer', () => {
    const css = compileStatusPageThemeCss('command-center');

    expect(css).toContain('--status-text: #f8fafc');
    expect(css).toContain('--status-text-strong: #f8fafc');
    expect(css).toContain('--status-panel-bg: #0b1020');
    expect(css).toContain('--status-panel-muted-bg: #111a30');
    expect(css).toContain('--status-panel-border: color-mix');
    expect(css).toContain('.status-page-surface .status-v3-service');
    expect(css).toContain('background: var(--status-panel-bg);');
    expect(css).toContain('.status-page-surface .status-v3-inspector');
  });

  it('does not inject dark semantic overrides into light themes', () => {
    const css = compileStatusPageThemeCss('executive');

    expect(resolveStatusPageTheme('executive').mode).toBe('light');
    expect(css).not.toContain('color-scheme: dark');
    expect(css).not.toContain('--status-operational:');
    expect(css).not.toContain('--status-major-outage:');
    expect(css).not.toContain('.status-page-surface .status-v3-inspector');
  });

  it('classifies the curated dark themes explicitly', () => {
    const darkThemes = STATUS_PAGE_THEMES.filter(theme => theme.mode === 'dark').map(
      theme => theme.id
    );

    expect(darkThemes).toEqual([
      'global-operations',
      'terminal',
      'arena-neon',
      'command-center',
    ]);
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
