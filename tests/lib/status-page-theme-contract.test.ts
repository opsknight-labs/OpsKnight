import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATUS_PAGE_COLORS,
  STATUS_PAGE_COLOR_PRESETS,
  computeStatusPageTheme,
} from '@/lib/status-page-theme';
import { STATUS_PAGE_PUBLIC_CSS } from '@/lib/status-pages/public-css';
import {
  DEFAULT_STATUS_PAGE_THEME_ID,
  STATUS_PAGE_THEMES,
  compileStatusPageThemeCss,
  isLegacyStatusPageTemplateCss,
  resolveStatusPageTheme,
} from '@/lib/status-pages/theme-contract';

type Rgb = [number, number, number];

function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '');
  return [
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  ];
}

function mix(left: string, right: string, leftWeight: number): Rgb {
  const a = hexToRgb(left);
  const b = hexToRgb(right);
  const rightWeight = 1 - leftWeight;
  return [
    a[0] * leftWeight + b[0] * rightWeight,
    a[1] * leftWeight + b[1] * rightWeight,
    a[2] * leftWeight + b[2] * rightWeight,
  ];
}

function relativeLuminance(value: string | Rgb): number {
  const rgb = typeof value === 'string' ? hexToRgb(value) : value;
  const toLinear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const red = toLinear(rgb[0]);
  const green = toLinear(rgb[1]);
  const blue = toLinear(rgb[2]);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(left: string | Rgb, right: string | Rgb): number {
  const a = relativeLuminance(left);
  const b = relativeLuminance(right);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('status page design contract', () => {
  it('keeps the color reset target equal to the native renderer colors', () => {
    expect(DEFAULT_STATUS_PAGE_COLORS).toEqual({
      primary: '#667eea',
      background: '#ffffff',
      text: '#111827',
    });

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

  it('bridges every curated palette into the V3 surface token namespace', () => {
    for (const theme of STATUS_PAGE_THEMES.filter(item => item.id !== DEFAULT_STATUS_PAGE_THEME_ID)) {
      const css = compileStatusPageThemeCss(theme.id);

      expect(css).toContain(':where(.status-page-surface) {');
      expect(css).toContain(`--status-text: ${theme.preview.text}`);
      expect(css).toContain(`--status-text-strong: ${theme.preview.text}`);
      expect(css).toContain(`--status-panel-bg: ${theme.preview.surface}`);
      expect(css).toContain(`--status-panel-muted-bg: ${theme.preview.surfaceAlt}`);
      expect(css).toContain('--status-primary: var(--sp-theme-accent)');
      expect(css).toContain(':where(.status-page-surface) .status-v3-service');
      expect(css).toContain('background: var(--status-panel-bg);');
    }
  });

  it('keeps built-in scoping weaker than the supported Advanced CSS hooks', () => {
    const css = compileStatusPageThemeCss('command-center');

    expect(css).toContain(':where(.status-page-container) .status-v3-service');
    expect(css).toContain(':where(.status-page-surface) .status-v3-service');
    expect(css).not.toContain('.status-page-container .status-page-surface {');
    expect(css).not.toContain('.status-page-container .status-page-surface .status-v3-service');
  });

  it('hardens dark themes against inherited light semantic tokens', () => {
    const css = compileStatusPageThemeCss('command-center');

    expect(resolveStatusPageTheme('command-center').mode).toBe('dark');
    expect(css).toContain('color-scheme: dark');
    expect(css).toContain('--sp-ink: #f8fafc');
    expect(css).toContain('--status-operational: #6ee7b7');
    expect(css).toContain('--status-operational-bg: color-mix');
    expect(css).toContain('--status-major-outage: #fda4af');
    expect(css).toContain('.status-topbar__chip--accent');
    expect(css).toContain('.status-subscribe__button');
  });

  it('connects the shared service-card CSS to the curated tokens', () => {
    const css = compileStatusPageThemeCss('command-center');

    expect(css).toContain('--status-text-muted: color-mix');
    expect(css).toContain('--status-text-subtle: color-mix');
    expect(css).toContain('--status-panel-border: color-mix');
    expect(css).toContain(':where(.status-page-surface) .status-v3-inspector');

    expect(STATUS_PAGE_PUBLIC_CSS).toContain('.status-v3-service__name');
    expect(STATUS_PAGE_PUBLIC_CSS).toContain('color: var(--status-text-strong)');
    expect(STATUS_PAGE_PUBLIC_CSS).toContain('.status-v3-service__desc');
    expect(STATUS_PAGE_PUBLIC_CSS).toContain('color: var(--status-text-muted)');
    expect(STATUS_PAGE_PUBLIC_CSS).toContain('.status-v3-chip {');
    expect(STATUS_PAGE_PUBLIC_CSS).toContain('background: var(--status-panel-muted-bg)');
    expect(STATUS_PAGE_PUBLIC_CSS).toContain('.status-v3-history__axis');
    expect(STATUS_PAGE_PUBLIC_CSS).toContain('.status-v3-inspector__date');
  });

  it('hardens every dark-only badge, tally and accent-foreground path', () => {
    for (const theme of STATUS_PAGE_THEMES.filter(item => item.mode === 'dark')) {
      const css = compileStatusPageThemeCss(theme.id);

      expect(css).toContain('[data-badge="true"][data-variant="success"]');
      expect(css).toContain('[data-badge="true"][data-variant="warning"]');
      expect(css).toContain('[data-badge="true"][data-variant="info"]');
      expect(css).toContain('[data-badge="true"][data-variant="danger"]');
      expect(css).toContain('.status-v3-group__tally-pill--healthy');
      expect(css).toContain('.status-v3-group__tally-pill--impacted');
      expect(css).toContain('.status-v3-regions-inline__tally-pill--healthy');
      expect(css).toContain('.status-v3-regions-inline__tally-pill--impacted');
      expect(css).toContain('.status-v3-maintenance-inline__tally-pill--active');
      expect(css).toContain('.status-v3-maintenance-inline__tally-pill--scheduled');
      expect(css).toContain('.status-v3-maintenance-inline__tally-pill--completed');
      expect(css).toContain('.status-v3-incidents-inline__tally-pill--active');
      expect(css).toContain('.status-v3-incidents-inline__tally-pill--resolved');
      expect(css).toContain('.status-v3-announcements-inline__tally-pill--changelog');
      expect(css).toContain('.status-v3-incident-pill__redacted-badge');
      expect(css).toContain('.status-v3-incident-pill__pir');
    }
  });

  it('keeps dark theme text, muted copy and accent controls above normal-text contrast', () => {
    for (const theme of STATUS_PAGE_THEMES.filter(item => item.mode === 'dark')) {
      const { surface, surfaceAlt, accent, text } = theme.preview;
      const muted = mix(text, surface, 0.72);
      const subtle = mix(text, surface, 0.56);
      const css = compileStatusPageThemeCss(theme.id);
      const accentText = css.includes('--sp-theme-accent-contrast: #ffffff')
        ? '#ffffff'
        : '#0b1020';

      const checks: Array<[string, number]> = [
        ['primary text', contrastRatio(text, surface)],
        ['muted text', contrastRatio(muted, surface)],
        ['subtle text', contrastRatio(subtle, surfaceAlt)],
        ['accent foreground', contrastRatio(accentText, accent)],
      ];
      for (const [label, ratio] of checks) {
        expect(ratio, `${theme.id}: ${label}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('uses WCAG-readable white foregrounds on dark-theme badge gradient endpoints', () => {
    const endpoints = [
      '#047857',
      '#15803d',
      '#b45309',
      '#c2410c',
      '#2563eb',
      '#4338ca',
      '#dc2626',
      '#be123c',
    ];

    for (const endpoint of endpoints) {
      expect(contrastRatio('#ffffff', endpoint), endpoint).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps dark-only semantic hardening out of light themes', () => {
    const css = compileStatusPageThemeCss('executive');

    expect(resolveStatusPageTheme('executive').mode).toBe('light');
    expect(css).toContain('--status-panel-bg: #ffffff');
    expect(css).not.toContain('color-scheme: dark');
    expect(css).not.toContain('--status-operational:');
    expect(css).not.toContain('--status-major-outage:');
    expect(css).not.toContain('[data-badge="true"][data-variant="success"]');
    expect(css).not.toContain('.status-v3-group__tally-pill--healthy');
    expect(css).not.toContain('.status-v3-incident-pill__redacted-badge');
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
